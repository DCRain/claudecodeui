import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    killed: false,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
  };
}

test('a stale socket close cannot detach the socket that replaced it', () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `stale-close-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    isPlainShell: true,
    initialCommand: 'test-command',
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  replacementSocket.frames.length = 0;

  // This ordering reproduces a delayed close from a backgrounded mobile tab.
  firstSocket.emit('close');
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);

  pty.emitExit();
});

test('shell output detects and normalizes a wrapped authentication URL', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `wrapped-url-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    })
  );
  socket.frames.length = 0;

  pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
  assert.deepEqual(authenticationFrame, {
    type: 'auth_url',
    url: 'https://example.com/authorize?code=abc',
    autoOpen: false,
  });

  pty.emitExit();
});

test('plain shell resolves ~ to the user home directory', () => {
  const pty = createFakePty();
  let spawnedCwd = '';
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: (_file: string, _args: string[], options: { cwd?: string }) => {
      spawnedCwd = options.cwd ?? '';
      return pty as never;
    },
  };
  const socket = createFakeSocket();

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: '~',
      sessionId: null,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      clientTerminalId: `home-cwd-${Date.now()}`,
    })
  );

  assert.equal(spawnedCwd, os.homedir());
  assert.match(socket.frames[0] ?? '', /Starting .+ in:/);
  pty.emitExit();
});

test('clientTerminalId isolates plain shell PTY sessions that share a cwd', () => {
  const firstPty = createFakePty();
  const secondPty = createFakePty();
  const spawned: Array<{ cwd?: string }> = [];
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: (_file: string, _args: string[], options: { cwd?: string }) => {
      spawned.push(options);
      return (spawned.length === 1 ? firstPty : secondPty) as never;
    },
  };

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: '~',
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      clientTerminalId: 'tab-a',
    })
  );

  const secondSocket = createFakeSocket();
  handleShellConnection(secondSocket as never, dependencies);
  secondSocket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: '~',
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      clientTerminalId: 'tab-b',
    })
  );

  assert.equal(spawned.length, 2);
  assert.equal(firstPty.killed, false);
  assert.equal(secondPty.killed, false);

  firstPty.emitExit();
  secondPty.emitExit();
});
