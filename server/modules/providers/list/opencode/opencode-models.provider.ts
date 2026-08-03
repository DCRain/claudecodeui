import Database from 'better-sqlite3';
import crossSpawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  getOpenCodeDatabasePath,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

export const OPENCODE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'opencode/big-pickle',
      label: 'Big Pickle',
      description: 'opencode - opencode/big-pickle',
    },
    {
      value: 'opencode/deepseek-v4-flash-free',
      label: 'DeepSeek V4 Flash Free',
      description: 'opencode - opencode/deepseek-v4-flash-free',
    },
    {
      value: 'opencode/laguna-s-2.1-free',
      label: 'Laguna S 2.1 Free',
      description: 'opencode - opencode/laguna-s-2.1-free',
    },
    {
      value: 'opencode/ling-3.0-flash-free',
      label: 'Ling-3.0-flash Free',
      description: 'opencode - opencode/ling-3.0-flash-free',
    },
    {
      value: 'opencode/mimo-v2.5-free',
      label: 'MiMo V2.5 Free',
      description: 'opencode - opencode/mimo-v2.5-free',
    },
    {
      value: 'opencode/nemotron-3-ultra-free',
      label: 'Nemotron 3 Ultra Free',
      description: 'opencode - opencode/nemotron-3-ultra-free',
    },
    {
      value: 'opencode/north-mini-code-free',
      label: 'North Mini Code Free',
      description: 'opencode - opencode/north-mini-code-free',
    },
  ],
  DEFAULT: 'opencode/big-pickle',
};

const OPEN_CODE_MODELS_TIMEOUT_MS = 20_000;
// Accept provider/model and provider/org/model style ids from OpenCode CLI output.
const MODEL_ID_LINE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]+)+$/i;
// cross-spawn resolves .cmd shims/PATHEXT on Windows and delegates to
// child_process.spawn everywhere else.
const spawnFunction = crossSpawn;
const DATE_TOKEN = /^\d{8}$/;
const SIMPLE_NUMBER_TOKEN = /^\d$/;
const VERSION_TOKEN = /^[a-z]\d+$/i;
const NUMERIC_TOKEN = /^\d+(?:\.\d+)*$/;
const SHORT_ACRONYM_TOKEN = /^[a-z]{2,3}$/;

type OpenCodeVerboseModel = {
  id?: string;
  name?: string;
  providerID?: string;
  providerId?: string;
  provider?: string;
  variants?: Record<string, unknown>;
};

const pushUniqueModelId = (ids: string[], id: string): void => {
  if (!MODEL_ID_LINE.test(id) || ids.includes(id)) {
    return;
  }

  ids.push(id);
};

const countJsonBraceDelta = (value: string): number => {
  let delta = 0;
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = inString;
      continue;
    }

    if (character === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === '{') {
      delta += 1;
    } else if (character === '}') {
      delta -= 1;
    }
  }

  return delta;
};

const isOpenCodeVerboseModel = (value: unknown): value is OpenCodeVerboseModel => {
  const record = readObjectRecord(value);
  return Boolean(record && readOptionalString(record.id));
};

const readOpenCodeVerboseProviderId = (model: OpenCodeVerboseModel): string | null => (
  readOptionalString(model.providerID)
  ?? readOptionalString(model.providerId)
  ?? readOptionalString(model.provider)
  ?? null
);

const readOpenCodeVerboseModelId = (model: OpenCodeVerboseModel): string | null => {
  const id = readOptionalString(model.id);
  if (!id) {
    return null;
  }

  if (id.includes('/')) {
    return id;
  }

  const upstreamProvider = readOpenCodeVerboseProviderId(model);
  return upstreamProvider ? `${upstreamProvider}/${id}` : id;
};

const collectModelIdsFromUnknown = (value: unknown, ids: string[]): void => {
  if (typeof value === 'string') {
    pushUniqueModelId(ids, value.trim());
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectModelIdsFromUnknown(entry, ids);
    }
    return;
  }

  const record = readObjectRecord(value);
  if (!record) {
    return;
  }

  if (Array.isArray(record.models)) {
    collectModelIdsFromUnknown(record.models, ids);
  }

  const verboseId = readOpenCodeVerboseModelId(record as OpenCodeVerboseModel);
  if (verboseId) {
    pushUniqueModelId(ids, verboseId);
  }
};

const collectVerboseModelsFromUnknown = (
  value: unknown,
  models: OpenCodeVerboseModel[],
  seen = new Set<string>(),
): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectVerboseModelsFromUnknown(entry, models, seen);
    }
    return;
  }

  const record = readObjectRecord(value);
  if (!record) {
    return;
  }

  if (Array.isArray(record.models)) {
    collectVerboseModelsFromUnknown(record.models, models, seen);
  }

  if (!isOpenCodeVerboseModel(record)) {
    return;
  }

  const modelId = readOpenCodeVerboseModelId(record);
  if (!modelId || seen.has(modelId)) {
    return;
  }

  seen.add(modelId);
  models.push(record);
};

export const parseOpenCodeModelsStdout = (stdout: string): string[] => {
  const ids: string[] = [];
  const trimmed = stdout.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      collectModelIdsFromUnknown(JSON.parse(trimmed), ids);
      if (ids.length > 0) {
        return ids;
      }
    } catch {
      // Fall through to the line-oriented parser used by older CLI output.
    }
  }

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('{') || line.startsWith('[')) {
      continue;
    }

    pushUniqueModelId(ids, line);
  }

  return ids;
};

export const parseOpenCodeVerboseModelsStdout = (stdout: string): OpenCodeVerboseModel[] => {
  const models: OpenCodeVerboseModel[] = [];
  const trimmed = stdout.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      collectVerboseModelsFromUnknown(JSON.parse(trimmed), models);
      if (models.length > 0) {
        return models;
      }
    } catch {
      // Fall through to the multi-line verbose object parser.
    }
  }

  let buffer: string[] = [];
  let depth = 0;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (buffer.length === 0) {
      if (line.startsWith('{') && line.endsWith('}') && line.length > 1) {
        try {
          const parsed = JSON.parse(line);
          if (isOpenCodeVerboseModel(parsed)) {
            models.push(parsed);
          }
        } catch {
          // Ignore malformed single-line JSON objects.
        }
        continue;
      }

      if (line === '{' || (line.startsWith('{') && !line.endsWith('}'))) {
        buffer = [rawLine];
        depth = countJsonBraceDelta(rawLine);
      }
      continue;
    }

    buffer.push(rawLine);
    depth += countJsonBraceDelta(rawLine);

    if (depth !== 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(buffer.join('\n'));
      if (isOpenCodeVerboseModel(parsed)) {
        models.push(parsed);
      }
    } catch {
      // Ignore malformed verbose blocks and fall back to the plain id parser.
    }

    buffer = [];
  }

  return models;
};

const formatDateToken = (token: string): string => (
  `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`
);

const formatModelToken = (token: string, nextToken?: string): string => {
  const lower = token.toLowerCase();

  if (VERSION_TOKEN.test(token)) {
    return token.toUpperCase();
  }

  if (SHORT_ACRONYM_TOKEN.test(lower) && nextToken && NUMERIC_TOKEN.test(nextToken)) {
    return token.toUpperCase();
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const formatOpenCodeModelSlug = (slug: string): string => {
  const labelParts: string[] = [];
  const dateParts: string[] = [];
  const tokens = slug.split('-').filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];

    if (DATE_TOKEN.test(token)) {
      dateParts.push(formatDateToken(token));
      continue;
    }

    if (SIMPLE_NUMBER_TOKEN.test(token) && nextToken && SIMPLE_NUMBER_TOKEN.test(nextToken)) {
      labelParts.push(`${token}.${nextToken}`);
      index += 1;
      continue;
    }

    labelParts.push(formatModelToken(token, nextToken));
  }

  const label = (labelParts.join(' ').trim() || slug).replace(/^GPT\s+/, 'GPT-');
  if (dateParts.length === 0) {
    return label;
  }

  return `${label} (${dateParts.join(', ')})`;
};

const readOpenCodeModelParts = (id: string): { upstreamProvider: string; slug: string } => {
  const separatorIndex = id.indexOf('/');
  if (separatorIndex < 0) {
    return {
      upstreamProvider: '',
      slug: id,
    };
  }

  return {
    upstreamProvider: id.slice(0, separatorIndex),
    slug: id.slice(separatorIndex + 1),
  };
};

const isSupportedOpenCodeModelId = (id: string): boolean => {
  const trimmed = id.trim();
  return trimmed.includes('/') && trimmed.length > 2;
};

const openCodeModelSortRank = (id: string): number => {
  const { upstreamProvider, slug } = readOpenCodeModelParts(id);
  if (upstreamProvider.toLowerCase() !== 'opencode') {
    return 2;
  }

  const normalizedSlug = slug.toLowerCase();
  if (
    normalizedSlug.includes('free')
    || normalizedSlug === 'big-pickle'
    || normalizedSlug === 'gpt-5-nano'
  ) {
    return 0;
  }

  return 1;
};

const sortOpenCodeModelOptions = (options: ProviderModelOption[]): ProviderModelOption[] => {
  const freeOptions: ProviderModelOption[] = [];
  const otherOptions: ProviderModelOption[] = [];

  for (const option of options) {
    if (openCodeModelSortRank(option.value) === 0) {
      freeOptions.push(option);
    } else {
      otherOptions.push(option);
    }
  }

  return [...freeOptions, ...otherOptions];
};

const labelForOpenCodeModelId = (id: string): string => {
  const fallbackLabel = OPENCODE_FALLBACK_MODELS.OPTIONS.find((option) => option.value === id)?.label;
  if (fallbackLabel) {
    return fallbackLabel;
  }

  const { slug } = readOpenCodeModelParts(id);
  return formatOpenCodeModelSlug(slug);
};

const descriptionForOpenCodeModelId = (id: string): string => {
  const { upstreamProvider } = readOpenCodeModelParts(id);
  return upstreamProvider ? `${upstreamProvider} - ${id}` : id;
};

const readOpenCodeVariantEffort = (key: string, value: unknown): string | null => {
  const variant = readObjectRecord(value);
  return readOptionalString(variant?.reasoningEffort)
    ?? readOptionalString(variant?.effort)
    ?? key;
};

const readOpenCodeEffortValues = (
  variants: OpenCodeVerboseModel['variants'],
): NonNullable<ProviderModelOption['effort']>['values'] => {
  const effortValues: NonNullable<ProviderModelOption['effort']>['values'] = [];
  const seenValues = new Set<string>();

  for (const [key, value] of Object.entries(variants ?? {})) {
    const effort = readOpenCodeVariantEffort(key, value);
    if (!effort || seenValues.has(effort)) {
      continue;
    }

    seenValues.add(effort);
    effortValues.push({ value: effort });
  }

  return effortValues;
};

const mapOpenCodeVerboseModel = (model: OpenCodeVerboseModel): ProviderModelOption | null => {
  const value = readOpenCodeVerboseModelId(model);
  if (!value || !isSupportedOpenCodeModelId(value)) {
    return null;
  }

  const effortValues = readOpenCodeEffortValues(model.variants);

  return {
    value,
    label: readOptionalString(model.name) ?? labelForOpenCodeModelId(value),
    description: descriptionForOpenCodeModelId(value),
    effort: effortValues.length > 0
      ? {
          values: effortValues,
        }
      : undefined,
  };
};

export const buildOpenCodeDefinitionFromIds = (ids: string[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = sortOpenCodeModelOptions(
    ids
      .filter(isSupportedOpenCodeModelId)
      .map((value) => ({
        value,
        label: labelForOpenCodeModelId(value),
        description: descriptionForOpenCodeModelId(value),
      })),
  );

  const defaultValue = options.find((option) => option.value === OPENCODE_FALLBACK_MODELS.DEFAULT)?.value
    ?? options[0]?.value
    ?? OPENCODE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

export const buildOpenCodeDefinitionFromVerboseModels = (
  models: OpenCodeVerboseModel[],
): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    const mappedModel = mapOpenCodeVerboseModel(model);
    if (!mappedModel || seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return OPENCODE_FALLBACK_MODELS;
  }

  const sortedOptions = sortOpenCodeModelOptions(options);
  const defaultValue = sortedOptions.find((option) => option.value === OPENCODE_FALLBACK_MODELS.DEFAULT)?.value
    ?? sortedOptions[0]?.value
    ?? OPENCODE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: sortedOptions,
    DEFAULT: defaultValue,
  };
};

export const mergeOpenCodeDefinitionWithIds = (
  definition: ProviderModelsDefinition,
  ids: string[],
): ProviderModelsDefinition => {
  const options = [...definition.OPTIONS];
  const seenValues = new Set(options.map((option) => option.value));

  for (const id of ids) {
    if (!isSupportedOpenCodeModelId(id) || seenValues.has(id)) {
      continue;
    }

    seenValues.add(id);
    options.push({
      value: id,
      label: labelForOpenCodeModelId(id),
      description: descriptionForOpenCodeModelId(id),
    });
  }

  const sortedOptions = sortOpenCodeModelOptions(options);
  const defaultValue = sortedOptions.find((option) => option.value === definition.DEFAULT)?.value
    ?? sortedOptions.find((option) => option.value === OPENCODE_FALLBACK_MODELS.DEFAULT)?.value
    ?? sortedOptions[0]?.value
    ?? OPENCODE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: sortedOptions,
    DEFAULT: defaultValue,
  };
};

/**
 * OpenCode Zen free models are not always present in `opencode models` output
 * (for example when Zen auth is missing or the CLI only lists configured paid
 * providers). Always surface the known free options so the UI can select them.
 */
export const ensureOpenCodeFreeModels = (
  definition: ProviderModelsDefinition,
): ProviderModelsDefinition => {
  const freeModelIds = OPENCODE_FALLBACK_MODELS.OPTIONS
    .filter((option) => openCodeModelSortRank(option.value) === 0)
    .map((option) => option.value);

  return mergeOpenCodeDefinitionWithIds(definition, freeModelIds);
};

const parseOpenCodeSessionModelValue = (rawModel: unknown): string | null => {
  if (typeof rawModel === 'string') {
    const trimmed = rawModel.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parseOpenCodeSessionModelValue(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }

  const record = readObjectRecord(rawModel);
  if (!record) {
    return null;
  }

  return readOptionalString(record.id)
    ?? readOptionalString(record.model)
    ?? readOptionalString(record.name)
    ?? readOptionalString(record.value)
    ?? null;
};

const runOpenCodeModelsCommand = (): Promise<string> => new Promise((resolve, reject) => {
  const openCodeProcess = spawnFunction('opencode', ['models', '--verbose'], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    openCodeProcess.kill('SIGTERM');
    if (!settled) {
      settled = true;
      reject(new Error('opencode models timed out'));
    }
  }, OPEN_CODE_MODELS_TIMEOUT_MS);

  const finish = (error: Error | null, output: string) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);

    if (error) {
      reject(error);
      return;
    }

    resolve(output);
  };

  openCodeProcess.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  openCodeProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  openCodeProcess.on('error', (error) => {
    finish(error instanceof Error ? error : new Error(String(error)), '');
  });

  openCodeProcess.on('close', (code) => {
    if (code !== 0) {
      finish(new Error(stderr.trim() || `opencode models exited with code ${code}`), '');
      return;
    }

    finish(null, stdout);
  });
});

export class OpenCodeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    try {
      const stdout = await runOpenCodeModelsCommand();
      const ids = parseOpenCodeModelsStdout(stdout);
      const verboseModels = parseOpenCodeVerboseModelsStdout(stdout);

      if (verboseModels.length > 0) {
        return ensureOpenCodeFreeModels(
          mergeOpenCodeDefinitionWithIds(
            buildOpenCodeDefinitionFromVerboseModels(verboseModels),
            ids,
          ),
        );
      }

      if (ids.length === 0) {
        return OPENCODE_FALLBACK_MODELS;
      }

      return ensureOpenCodeFreeModels(buildOpenCodeDefinitionFromIds(ids));
    } catch {
      return OPENCODE_FALLBACK_MODELS;
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    // OpenCode's `session` table is keyed by its own session id, so the stable
    // app id has to be translated first; sessions discovered on disk store the
    // provider id in both columns and resolve to themselves.
    const providerSessionId = sessionsDb.getSessionById(sessionId)?.provider_session_id ?? sessionId;

    try {
      const dbPath = getOpenCodeDatabasePath();
      const db = new Database(dbPath, { readonly: true, fileMustExist: true });

      try {
        const row = db.prepare(`
          SELECT
            s.id AS sessionId,
            s.model AS model,
            s.agent AS agent,
            s.directory AS directory,
            s.time_updated AS timeUpdated,
            s.time_created AS timeCreated
          FROM session s
          WHERE s.id = ?
          ORDER BY COALESCE(s.time_updated, s.time_created, 0) DESC
          LIMIT 1
        `).get(providerSessionId) as {
          sessionId?: string;
          model?: unknown;
          agent?: string | null;
          directory?: string | null;
          timeUpdated?: number | null;
          timeCreated?: number | null;
        } | undefined;

        const model = parseOpenCodeSessionModelValue(row?.model);
        if (model) {
          return {
            model,
          };
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to the provider default when OpenCode session lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
