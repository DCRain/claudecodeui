import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const PROVIDER = 'qoder';

export class QoderSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) return [];

    const type = readOptionalString(raw.type) ?? readOptionalString(raw.event);
    const eventSessionId = readOptionalString(raw.sessionID) ?? readOptionalString(raw.sessionId) ?? readOptionalString(raw.session_id) ?? sessionId;
    const timestamp = normalizeProviderTimestamp(raw.time ?? raw.timestamp);
    const baseId = readOptionalString(raw.id) ?? readOptionalString(raw.messageID) ?? generateMessageId('qoder');

    if (type === 'text' || type === 'text_delta') {
      const content = readOptionalString(raw.text) ?? readOptionalString(raw.delta) ?? readOptionalString(raw.content) ?? '';
      if (!content.trim()) return [];
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'stream_delta', content,
      })];
    }

    if (type === 'reasoning' || type === 'thinking') {
      const content = readOptionalString(raw.text) ?? readOptionalString(raw.delta) ?? readOptionalString(raw.content) ?? '';
      if (!content.trim()) return [];
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'thinking', content,
      })];
    }

    if (type === 'tool_use' || type === 'tool_call') {
      const toolName = readOptionalString(raw.tool) ?? readOptionalString(raw.name) ?? 'Tool';
      const toolId = readOptionalString(raw.callID) ?? readOptionalString(raw.toolCallId) ?? baseId;
      const toolMessage = createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'tool_use', toolName,
        toolInput: raw.input ?? raw.arguments ?? raw.toolInput ?? {},
        toolId,
      });
      if (raw.output !== undefined || raw.error !== undefined) {
        toolMessage.toolResult = {
          content: typeof (raw.output ?? raw.error) === 'string' ? (raw.output ?? raw.error) : JSON.stringify(raw.output ?? raw.error),
          isError: raw.error !== undefined,
        };
      }
      return [toolMessage];
    }

    if (type === 'error') {
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'error',
        content: readOptionalString(raw.error) ?? readOptionalString(raw.message) ?? 'Unknown Qoder error',
      })];
    }

    if (type === 'result' || type === 'complete' || type === 'step_finish') {
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'stream_end',
      })];
    }

    if (type === 'system') {
      const sub = readOptionalString(raw.subtype);
      if (sub === 'init') {
        const initSessionId = readOptionalString(raw.session_id);
        if (initSessionId) {
          return [createNormalizedMessage({
            id: baseId, sessionId: initSessionId, timestamp, provider: PROVIDER,
            kind: 'session_created', newSessionId: initSessionId,
          })];
        }
      }
      return [];
    }

    return [];
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }
}
