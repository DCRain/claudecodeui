import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
} from '@/shared/utils.js';

const fileExists = async (filePath: string): Promise<boolean> => {
  try { await access(filePath); return true; } catch { return false; }
};

const readTraeConfig = async (filePath: string): Promise<Record<string, unknown>> => {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return readObjectRecord(parsed) ?? {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
};

const writeTraeConfig = async (filePath: string, data: Record<string, unknown>): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const resolveTraeConfigPath = async (scope: McpScope, workspacePath: string): Promise<{ filePath: string }> => {
  const root = scope === 'user'
    ? path.join(os.homedir(), '.trae')
    : path.join(workspacePath, '.trae');
  const filePath = path.join(root, 'mcp.json');
  return { filePath };
};

export class TraeMcpProvider extends McpProvider {
  constructor() {
    super('trae', ['user', 'project'], ['stdio', 'http']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    const { filePath } = await resolveTraeConfigPath(scope, workspacePath);
    if (!(await fileExists(filePath))) return {};
    const config = await readTraeConfig(filePath);
    return readObjectRecord(config.mcpServers) ?? {};
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    const { filePath } = await resolveTraeConfigPath(scope, workspacePath);
    const config = await readTraeConfig(filePath);
    config.mcpServers = servers;
    await writeTraeConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED', statusCode: 400,
        });
      }
      return { type: 'local', command: [input.command, ...(input.args ?? [])], enabled: true };
    }
    if (!input.url?.trim()) {
      throw new AppError('url is required for http MCP servers.', {
        code: 'MCP_URL_REQUIRED', statusCode: 400,
      });
    }
    return { type: 'remote', url: input.url, enabled: true, headers: input.headers ?? {} };
  }

  protected normalizeServerConfig(
    scope: McpScope, name: string, rawConfig: unknown,
  ): ProviderMcpServer | null {
    const config = readObjectRecord(rawConfig);
    if (!config) return null;

    if (config.type === 'local' || config.command !== undefined) {
      const commandParts = typeof config.command === 'string'
        ? [config.command, ...(readStringArray(config.args) ?? [])]
        : readStringArray(config.command);
      const command = commandParts?.[0];
      if (!command) return null;
      return {
        provider: 'trae', name, scope, transport: 'stdio', command,
        args: commandParts.slice(1),
        env: readStringRecord(config.environment) ?? readStringRecord(config.env),
      };
    }

    if (config.type === 'remote' || typeof config.url === 'string') {
      const url = readOptionalString(config.url);
      if (!url) return null;
      return { provider: 'trae', name, scope, transport: 'http', url, headers: readStringRecord(config.headers) };
    }

    return null;
  }
}
