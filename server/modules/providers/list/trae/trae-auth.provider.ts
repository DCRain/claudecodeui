import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type TraeCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class TraeProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('trae-cli', ['--help'], { stdio: 'ignore', timeout: 5000 });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();
    return {
      installed,
      provider: 'trae',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  private async checkCredentials(): Promise<TraeCredentialsStatus> {
    try {
      const configPath = path.join(os.homedir(), '.trae', 'trae_config.yaml');
      const content = await readFile(configPath, 'utf8');
      if (content.includes('api_key') || content.includes('apiKey')) {
        return { authenticated: true, email: 'trae config', method: 'config_file' };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return {
          authenticated: false, email: null, method: null,
          error: error instanceof Error ? error.message : 'Failed to read Trae config',
        };
      }
    }

    const envKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TRAE_API_KEY'];
    const envCredential = envKeys.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return { authenticated: true, email: envCredential, method: 'environment' };
    }

    return { authenticated: false, email: null, method: null, error: 'Trae not configured' };
  }
}
