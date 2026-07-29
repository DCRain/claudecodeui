import crossSpawn from 'cross-spawn';

import { sessionsService } from './modules/providers/services/sessions.service.js';
import { providerAuthService } from './modules/providers/services/provider-auth.service.js';
import { providerModelsService } from './modules/providers/services/provider-models.service.js';
import { notifyRunFailed, notifyRunStopped } from './services/notification-orchestrator.js';
import { createCompleteMessage, createNormalizedMessage, flattenPromptForWindowsShell } from './shared/utils.js';

const spawnFunction = crossSpawn;

const activeTraeProcesses = new Map();

function readTraeSessionId(event) {
  if (!event || typeof event !== 'object') return null;
  return event.sessionID || event.sessionId || event.session_id || null;
}

async function spawnTrae(command, options = {}, ws) {
  return new Promise((resolve, reject) => {
    const { sessionId, projectPath, cwd, model } = options;
    const workingDir = cwd || projectPath || process.cwd();
    const processKey = sessionId || Date.now().toString();
    let capturedSessionId = sessionId || null;
    let sessionCreatedSent = false;
    let stdoutLineBuffer = '';
    let terminalNotificationSent = false;
    let traeProcess = null;
    let completeSent = false;

    const notifyTerminalState = ({ code = null, error = null } = {}) => {
      if (terminalNotificationSent) return;
      terminalNotificationSent = true;
      const finalSessionId = capturedSessionId || sessionId || processKey;
      if (code === 0 && !error) {
        notifyRunStopped({
          userId: ws?.userId || null, provider: 'trae', sessionId: finalSessionId, stopReason: 'completed',
        });
        return;
      }
      notifyRunFailed({
        userId: ws?.userId || null, provider: 'trae', sessionId: finalSessionId, error: error || `Trae CLI exited with code ${code}`,
      });
    };

    const registerSession = (nextSessionId) => {
      if (!nextSessionId || capturedSessionId === nextSessionId) return;
      capturedSessionId = nextSessionId;
      if (processKey !== capturedSessionId && traeProcess) {
        activeTraeProcesses.delete(processKey);
        activeTraeProcesses.set(capturedSessionId, traeProcess);
      }
      if (traeProcess) traeProcess.sessionId = capturedSessionId;
      if (ws.setSessionId && typeof ws.setSessionId === 'function') ws.setSessionId(capturedSessionId);
      if (!sessionId && !sessionCreatedSent) {
        sessionCreatedSent = true;
        ws.send(createNormalizedMessage({
          kind: 'session_created', newSessionId: capturedSessionId, sessionId: capturedSessionId, provider: 'trae',
        }));
      }
    };

    const processTraeOutputLine = (line) => {
      if (!line || !line.trim()) return;
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        ws.send(createNormalizedMessage({
          kind: 'stream_delta', content: line, sessionId: capturedSessionId || sessionId || null, provider: 'trae',
        }));
        return;
      }
      try {
        registerSession(readTraeSessionId(response));
        const normalized = sessionsService.normalizeMessage('trae', response, capturedSessionId || sessionId || null);
        for (const msg of normalized) ws.send(msg);
      } catch (error) {
        const errorContent = error instanceof Error ? error.message : String(error);
        console.error('[Trae] Failed to process JSON output:', errorContent);
        ws.send(createNormalizedMessage({
          kind: 'error', content: errorContent, sessionId: capturedSessionId || sessionId || null, provider: 'trae',
        }));
      }
    };

    void providerModelsService.resolveResumeModel('trae', sessionId, model).then(async (resolvedModel) => {
      // trae-cli from bytedance/trae-agent (open-source)
      const args = ['run'];
      if (resolvedModel) args.push('--model', resolvedModel);
      if (workingDir) args.push('--working-dir', workingDir);
      if (command && command.trim()) {
        args.push(flattenPromptForWindowsShell(command.trim()));
      }

      traeProcess = spawnFunction('trae-cli', args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      activeTraeProcesses.set(processKey, traeProcess);
      traeProcess.sessionId = processKey;
      traeProcess.stdin.end();

      traeProcess.stdout.on('data', (data) => {
        stdoutLineBuffer += data.toString();
        const completeLines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = completeLines.pop() || '';
        completeLines.forEach((line) => processTraeOutputLine(line.trim()));
      });

      traeProcess.stderr.on('data', (data) => {
        const stderrText = data.toString();
        if (!stderrText.trim()) return;
        ws.send(createNormalizedMessage({
          kind: 'error', content: stderrText, sessionId: capturedSessionId || sessionId || null, provider: 'trae',
        }));
      });

      traeProcess.on('close', async (code) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeTraeProcesses.delete(finalSessionId);
        activeTraeProcesses.delete(processKey);
        if (stdoutLineBuffer.trim()) {
          processTraeOutputLine(stdoutLineBuffer.trim());
          stdoutLineBuffer = '';
        }
        if (!completeSent && !traeProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'trae', sessionId: finalSessionId, exitCode: code }));
        }
        if (code === 0) { notifyTerminalState({ code }); resolve(); return; }
        if (code === 127 || code === null) {
          const installed = await providerAuthService.isProviderInstalled('trae');
          if (!installed) {
            ws.send(createNormalizedMessage({
              kind: 'error', content: 'Trae CLI is not installed. Install it from https://github.com/bytedance/trae-agent', sessionId: finalSessionId, provider: 'trae',
            }));
          }
        }
        notifyTerminalState({ code });
        reject(new Error(code === null ? 'Trae CLI process was terminated' : `Trae CLI exited with code ${code}`));
      });

      traeProcess.on('error', async (error) => {
        const finalSessionId = capturedSessionId || sessionId || processKey;
        activeTraeProcesses.delete(finalSessionId);
        activeTraeProcesses.delete(processKey);
        const installed = await providerAuthService.isProviderInstalled('trae');
        const errorContent = !installed
          ? 'Trae CLI is not installed. Install it from https://github.com/bytedance/trae-agent'
          : error.message;
        ws.send(createNormalizedMessage({
          kind: 'error', content: errorContent, sessionId: finalSessionId, provider: 'trae',
        }));
        if (!completeSent && !traeProcess.aborted) {
          completeSent = true;
          ws.send(createCompleteMessage({ provider: 'trae', sessionId: finalSessionId, exitCode: 1 }));
        }
        notifyTerminalState({ error });
        reject(error);
      });
    }).catch(reject);
  });
}

function abortTraeSession(sessionId) {
  const process = activeTraeProcesses.get(sessionId);
  if (!process) return false;
  process.aborted = true;
  process.kill('SIGTERM');
  activeTraeProcesses.delete(sessionId);
  return true;
}

function isTraeSessionActive(sessionId) {
  return activeTraeProcesses.has(sessionId);
}

function getActiveTraeSessions() {
  return Array.from(activeTraeProcesses.keys());
}

export { spawnTrae, abortTraeSession, isTraeSessionActive, getActiveTraeSessions };
