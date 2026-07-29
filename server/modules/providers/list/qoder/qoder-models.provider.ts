import crossSpawn from 'cross-spawn';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderChangeActiveModelInput,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderSessionActiveModelChange,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  writeProviderSessionActiveModelChange,
} from '@/shared/utils.js';

export const QODER_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'Default', label: 'Default', description: 'qoder - Default' },
    { value: 'Pro', label: 'Pro', description: 'qoder - Pro' },
    { value: 'Ultimate', label: 'Ultimate', description: 'qoder - Ultimate' },
  ],
  DEFAULT: 'Default',
};

const QODER_MODELS_TIMEOUT_MS = 10_000;
const spawnFunction = crossSpawn;

export class QoderProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await this.runListModelsCommand();
      const modelIds = this.parseModelsOutput(stdout);
      if (modelIds.length === 0) {
        return QODER_FALLBACK_MODELS;
      }

      const options = modelIds.map((id) => ({
        value: id,
        label: id,
        description: `qoder - ${id}`,
      }));

      return {
        OPTIONS: options,
        DEFAULT: options[0].value,
      };
    } catch {
      return QODER_FALLBACK_MODELS;
    }
  }

  private parseModelsOutput(stdout: string): string[] {
    const lines = stdout.trim().split(/\r?\n/);
    const models: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'MODEL' || trimmed.startsWith('-')) continue;
      if (!models.includes(trimmed)) models.push(trimmed);
    }
    return models;
  }

  private runListModelsCommand(): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawnFunction('qodercli', ['--list-models'], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        if (!settled) { settled = true; reject(new Error('qodercli --list-models timed out')); }
      }, QODER_MODELS_TIMEOUT_MS);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `qodercli --list-models exited with code ${code}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('qoder', input);
  }
}
