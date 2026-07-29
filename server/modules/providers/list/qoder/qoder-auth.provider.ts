import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

type QoderStatusJson = {
  logged_in?: boolean;
  version?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
};

type QoderCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

export class QoderProviderAuth implements IProviderAuth {
  private checkInstalled(): boolean {
    try {
      const result = spawn.sync('qodercli', ['--version'], { stdio: 'ignore', timeout: 5000 });
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
      provider: 'qoder',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  private async checkCredentials(): Promise<QoderCredentialsStatus> {
    try {
      const statusResult = spawn.sync('qodercli', ['status', '-o', 'json'], {
        encoding: 'utf8',
        timeout: 8000,
      });

      if (statusResult.error || statusResult.status !== 0) {
        return { authenticated: false, email: null, method: null, error: 'Qoder CLI status check failed' };
      }

      const stdout = typeof statusResult.stdout === 'string' ? statusResult.stdout.trim() : '';
      if (!stdout) {
        return { authenticated: false, email: null, method: null, error: 'Qoder CLI returned empty status' };
      }

      const status: QoderStatusJson = JSON.parse(stdout);
      if (status.logged_in) {
        return {
          authenticated: true,
          email: status.email || status.username || null,
          method: 'cli_status',
        };
      }
    } catch {
      // Fall through to env check
    }

    const envKeys = ['QODER_API_KEY', 'QODER_ACCESS_TOKEN'];
    const envCredential = envKeys.find((key) => process.env[key]?.trim());
    if (envCredential) {
      return { authenticated: true, email: envCredential, method: 'environment' };
    }

    return { authenticated: false, email: null, method: null, error: 'Qoder not configured' };
  }
}
