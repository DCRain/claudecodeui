import crossSpawn from 'cross-spawn';

import { appendImagesInputTag } from './shared/image-attachments.js';
import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from './shared/utils.js';

const spawnFunction = crossSpawn;

const activeQoderProcesses = new Map();

function resolveQoderPermissionOptions(permissionMode) {
  switch (permissionMode) {
    case 'plan':
      return { args: ['--agent', 'plan'], env: {} };
    case 'bypassPermissions':
      return { args: ['--yolo'], env: {} };
    default:
      return { args: [], env: {} };
  }
}

function readQoderSessionId(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  return event.sessionID || event.sessionId || event.session_id || null;
}

async function spawnQoder(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model, permissionMode } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let qoderProcess = null;
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) return;
      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null, provider: 'qoder', sessionId: finalSessionId, stopReason: 'completed',
        });
        return;
      }
      notifyRunFailed({
        userId: ws?.userId || null, provider: 'qoder', sessionId: finalSessionId, error: error || `Qoder CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) return;
      capturedSessionId = nextSessionId;
      if (processKey !== capturedSessionId && qoderProcess) {
        activeQoderProcesses.delete(processKey);
        activeQoderProcesses.set(capturedSessionId, qoderProcess);
      }
      if (qoderProcess) qoderProcess.sessionId = capturedSessionId;
      if (ws.setSessionId && typeof ws.setSessionId === 'function') ws.setSessionId(capturedSessionId);
      if (!sessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'qoder',
        }));
      }
    };

    const processQoderOutputLine = (line) => {
      if (!line || !line.trim()) return;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta', content: line, sessionId: capturedSessionId || sessionId || null, provider: 'qoder',
        }));
        return;
      }
      try {
        registerSession(readQoderSessionId(response));
        const normalized = sessionsService.normalizeMessage('qoder', response, capturedSessionId || sessionId || null);
        for (const msg of normalized) ws.send(msg);
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Qoder] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'qoder',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('qoder', sessionId, model).then(async (resolvedModel) => {
      const args = ['-p'];
      if (resolvedModel) args.push('--model', resolvedModel);
      args.push('--output-format', 'stream-json');
      args.push('-w', workingDir);
      const permissionOptions = resolveQoderPermissionOptions(permissionMode);
      args.push(...permissionOptions.args);
      if (command && command.trim()) {
        args.push(flattenPromptForWindowsShell(appendImagesInputTag(command.trim(), options.images)));
      }

      qoderProcess = spawnFunction('qodercli', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...permissionOptions.env },
      });

      activeQoderProcesses.set(processKey, qoderProcess);
      qoderProcess.sessionId = processKey;
      qoderProcess.stdin.end();

      qoderProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';
        completeLines.forEach((line) => processQoderOutputLine(line.trim()));
      });

      qoderProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) return;
        ws.send(createNormalizedMessage({
          kind: 'error', content: stderrText, sessionId: capturedSessionId || sessionId || null, provider: 'qoder',
        }));
      });

      qoderProcess.on('close', async (code) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeQoderProcesses.delete(finalSessionId);
        activeQoderProcesses.delete(processKey);
        if (stdoutLineBuffer.trim()) {
          processQoderOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }
        if (!completeSent && !qoderProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'qoder', sessionId: finalSessionId, exitCode: code }));
        }
        if (code === 0) { notifyTerminalState({ code }); resolve(); return; }
        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('qoder');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error', content: 'Qoder CLI is not installed. Install it from https://qoder.com/', sessionId: finalSessionId, provider: 'qoder',
            }));
          }
        }
        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Qoder CLI process was terminated' : `Qoder CLI exited with code ${code}`));
      });

      qoderProcess.on('error', async (error) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeQoderProcesses.delete(finalSessionId);
        activeQoderProcesses.delete(processKey);
        const installed = await providerAuthService.isProviderInstalled('qoder');
        const errorContent = !installed
          ? 'Qoder CLI is not installed. Install it from https://qoder.com/'
          : error.message;
        ws.send(createNormalizedMessage({
          kind: 'error', content: errorContent, sessionId: finalSessionId, provider: 'qoder',
        }));
        if (!completeSent && !qoderProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'qoder', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortQoderSession(sessionId) {
  const process = activeQoderProcesses.get(sessionId);
  if (!process) return false;
  process.aborted = true;
  process.kill('SIGTERM');
  activeQoderProcesses.delete(sessionId);
  return true;
}

function isQoderSessionActive(sessionId) {
  return activeQoderProcesses.has(sessionId);
}

function getActiveQoderSessions() {
  return Array.from(activeQoderProcesses.keys());
}

export { spawnQoder, abortQoderSession, isQoderSessionActive, getActiveQoderSessions };
