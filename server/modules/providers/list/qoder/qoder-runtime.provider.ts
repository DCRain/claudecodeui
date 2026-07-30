import type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';

export const qoderRuntime = {
  async run(
    _command: string,
    _options: AnyRecord,
    _writer: ProviderRuntimeWriter,
    _context: ProviderRuntimeContext,
  ): Promise<unknown> {
    throw new Error('Qoder runtime is not yet implemented');
  },

  abort(_sessionId: string): boolean {
    return false;
  },
};
