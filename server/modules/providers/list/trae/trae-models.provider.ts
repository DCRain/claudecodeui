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

export const TRAE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5', description: 'anthropic - anthropic/claude-sonnet-4-5' },
    { value: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'anthropic - anthropic/claude-haiku-4-5' },
    { value: 'openai/gpt-4o', label: 'GPT-4o', description: 'openai - openai/gpt-4o' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'google - google/gemini-2.5-flash' },
    { value: 'deepseek/deepseek-v3', label: 'DeepSeek V3', description: 'deepseek - deepseek/deepseek-v3' },
  ],
  DEFAULT: 'anthropic/claude-sonnet-4-5',
};

const TRAE_MODELS_TIMEOUT_MS = 20_000;
const spawnFunction = crossSpawn;

const isSupportedModelId = (id: string): boolean => {
  const trimmed = id.trim();
  return trimmed.includes('/') && trimmed.length > 2;
};

const runTraeModelsCommand = (): Promise<string> => new Promise((resolve, reject) => {
  const proc = spawnFunction('trae-cli', ['show-config'], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    proc.kill('SIGTERM');
    if (!settled) { settled = true; reject(new Error('trae-cli show-config timed out')); }
  }, TRAE_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) { reject(error); return; }
    resolve(output);
  };

  proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  proc.on('error', (error) => { finish(error instanceof Error ? error : new Error(String(error)), ''); });
  proc.on('close', (code) => {
    if (code !== 0) { finish(new Error(stderr.trim() || `trae-cli show-config exited with code ${code}`), ''); return; }
    finish(null, stdout);
  });
});

const parseTraeModelsFromConfig = (stdout: string): string[] => {
  const modelIds: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (isSupportedModelId(trimmed)) {
      modelIds.push(trimmed);
    }
  }
  return modelIds;
};

export class TraeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runTraeModelsCommand();
      const modelIds = parseTraeModelsFromConfig(stdout);
      if (modelIds.length > 0) {
        const options = modelIds.map((id) => {
          const parts = id.split('/');
          const label = parts.length > 1 ? parts.slice(1).join('/') : id;
          return {
            value: id,
            label: label.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            description: id,
          };
        });
        return { OPTIONS: options, DEFAULT: options[0].value };
      }
    } catch {
      // Fall through to fallback models
    }
    return TRAE_FALLBACK_MODELS;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }

  async changeActiveModel(
    input: ProviderChangeActiveModelInput,
  ): Promise<ProviderSessionActiveModelChange> {
    return writeProviderSessionActiveModelChange('trae', input);
  }
}
