import type { IProviderSessions } from '@/shared/interfaces.js';
import type { FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

const PROVIDER = 'trae';

export class TraeSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) return [];

    const type = readOptionalString(raw.type) ?? readOptionalString(raw.event);
    const eventSessionId = readOptionalString(raw.sessionID) ?? readOptionalString(raw.sessionId) ?? readOptionalString(raw.session_id) ?? sessionId;
    const timestamp = normalizeProviderTimestamp(raw.time ?? raw.timestamp);
    const baseId = readOptionalString(raw.id) ?? readOptionalString(raw.messageID) ?? generateMessageId('trae');

    if (type === 'text' || type === 'text_delta' || type === 'message') {
      const content = readOptionalString(raw.text) ?? readOptionalString(raw.delta) ?? readOptionalString(raw.content) ?? readOptionalString(raw.message) ?? '';
      if (!content.trim()) return [];
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'stream_delta', content,
      })];
    }

    if (type === 'reasoning' || type === 'thinking' || type === 'agent_thought_chunk') {
      const content = readOptionalString(raw.text) ?? readOptionalString(raw.content) ?? '';
      if (!content.trim()) return [];
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'thinking', content,
      })];
    }

    if (type === 'agent_message_chunk') {
      const update = readObjectRecord(raw.update) ?? raw;
      const content = readOptionalString(update.content?.text) ?? readOptionalString(raw.text) ?? readOptionalString(raw.content) ?? '';
      if (!content.trim()) return [];
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'stream_delta', content,
      })];
    }

    if (type === 'tool_use' || type === 'tool_call' || type === 'tool_use_chunk') {
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
        content: readOptionalString(raw.error) ?? readOptionalString(raw.message) ?? 'Unknown Trae error',
      })];
    }

    if (type === 'result' || type === 'complete' || type === 'stop' || type === 'stream_end') {
      return [createNormalizedMessage({
        id: baseId, sessionId: eventSessionId, timestamp, provider: PROVIDER,
        kind: 'stream_end',
      })];
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
