import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, Plus, Play, Pencil, Trash2, X, ChevronDown, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';

type CustomCommand = {
  id: number;
  project_id: string;
  name: string;
  command: string;
  sort_order: number;
  created_at: string;
};

type OutputLine = {
  type: 'stdout' | 'stderr' | 'close' | 'error';
  data: string;
};

type CustomCommandsProps = {
  projectId: string;
};

export default function CustomCommands({ projectId }: CustomCommandsProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCommand, setEditingCommand] = useState<CustomCommand | null>(null);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [showOutput, setShowOutput] = useState(false);
  const [executingName, setExecutingName] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'execute' | 'delete';
    command: CustomCommand;
  } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchCommands = useCallback(async () => {
    try {
      const response = await api.customCommands.list(projectId);
      const data = await response.json();
      if (data.success) {
        setCommands(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch custom commands:', error);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
        setEditingCommand(null);
        setName('');
        setCommand('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !command.trim()) return;
    try {
      if (editingCommand) {
        await api.customCommands.update(editingCommand.id, { name, command });
      } else {
        await api.customCommands.create(projectId, name, command, commands.length);
      }
      setName('');
      setCommand('');
      setIsEditing(false);
      setEditingCommand(null);
      await fetchCommands();
    } catch (error) {
      console.error('Failed to save custom command:', error);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.customCommands.delete(id);
      await fetchCommands();
    } catch (error) {
      console.error('Failed to delete custom command:', error);
    }
  };

  const handleEdit = (cmd: CustomCommand) => {
    setEditingCommand(cmd);
    setName(cmd.name);
    setCommand(cmd.command);
    setIsEditing(true);
  };

  const handleTerminate = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsExecuting(false);
  };

  const handleExecute = async (cmd: CustomCommand) => {
    setIsExecuting(true);
    setExecutingName(cmd.name);
    setOutput([]);
    setShowOutput(true);
    setConfirmDialog(null);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Use authenticatedFetch (Authorization header) instead of EventSource,
      // which cannot set headers and used to 401 + auto-reconnect in a loop.
      const response = await api.customCommands.execute(cmd.id, {
        signal: controller.signal,
      });

      if (!response.ok) {
        const message =
          response.status === 401
            ? 'Unauthorized'
            : `Request failed (${response.status})`;
        setOutput((prev) => [...prev, { type: 'error', data: message }]);
        return;
      }

      if (!response.body) {
        setOutput((prev) => [...prev, { type: 'error', data: 'No response body' }]);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = 'message';

      const appendLine = (type: OutputLine['type'], data: string) => {
        setOutput((prev) => [...prev, { type, data }]);
      };

      const flushEvent = (rawData: string) => {
        let data = rawData;
        try {
          data = JSON.parse(rawData) as string;
        } catch {
          // Keep raw SSE data when it is not JSON-encoded.
        }

        if (eventName === 'stdout' || eventName === 'stderr' || eventName === 'error' || eventName === 'close') {
          appendLine(eventName, data);
        }
        eventName = 'message';
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';

        for (const line of parts) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            flushEvent(line.slice(5).trim());
          } else if (line === '') {
            eventName = 'message';
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        return;
      }
      console.error('Failed to execute custom command:', error);
      setOutput((prev) => [
        ...prev,
        { type: 'error', data: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsExecuting(false);
    }
  };

  const confirmExecute = (cmd: CustomCommand) => {
    setConfirmDialog({ type: 'execute', command: cmd });
  };

  const confirmDelete = (cmd: CustomCommand) => {
    setConfirmDialog({ type: 'delete', command: cmd });
  };

  const handleConfirm = () => {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'execute') {
      handleExecute(confirmDialog.command);
    } else {
      handleDelete(confirmDialog.command.id);
    }
    setConfirmDialog(null);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title={t('customCommands.title')}
      >
        <Terminal className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('customCommands.title')}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-background shadow-lg">
          <div className="border-b border-border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t('customCommands.title')}</h3>
              {!isEditing && (
                <button
                  onClick={() => {
                    setIsEditing(true);
                    setEditingCommand(null);
                    setName('');
                    setCommand('');
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-accent"
                >
                  <Plus className="h-3 w-3" />
                  {t('customCommands.add')}
                </button>
              )}
            </div>
          </div>

          {isEditing && (
            <div className="border-b border-border p-3">
              <input
                type="text"
                placeholder={t('customCommands.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <textarea
                rows={3}
                placeholder={t('customCommands.commandPlaceholder')}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSave();
                  }
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditingCommand(null);
                    setName('');
                    setCommand('');
                  }
                }}
                className="mb-2 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!name.trim() || !command.trim()}
                  className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {editingCommand ? t('customCommands.update') : t('customCommands.save')}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditingCommand(null);
                    setName('');
                    setCommand('');
                  }}
                  className="rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
                >
                  {t('customCommands.cancel')}
                </button>
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto">
            {commands.length === 0 && !isEditing ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {t('customCommands.noCommands')}
              </div>
            ) : (
              commands.map((cmd) => (
                <div
                  key={cmd.id}
                  className="flex items-center gap-2 border-b border-border/50 px-3 py-2 last:border-b-0 hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{cmd.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {cmd.command}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => confirmExecute(cmd)}
                      className="rounded p-1 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
                      title={t('customCommands.execute')}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleEdit(cmd)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent"
                      title={t('customCommands.edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => confirmDelete(cmd)}
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                      title={t('customCommands.delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-lg border border-border bg-background p-4 shadow-xl">
            <h4 className="mb-2 text-sm font-medium">
              {confirmDialog.type === 'execute'
                ? t('customCommands.confirmExecute', { name: confirmDialog.command.name })
                : t('customCommands.confirmDelete', { name: confirmDialog.command.name })}
            </h4>
            <p className="mb-4 text-xs text-muted-foreground">
              {confirmDialog.type === 'execute'
                ? confirmDialog.command.command
                : t('customCommands.deleteWarning')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
              >
                {t('customCommands.cancel')}
              </button>
              <button
                onClick={handleConfirm}
                className={`rounded-md px-3 py-1.5 text-xs text-white ${
                  confirmDialog.type === 'delete'
                    ? 'bg-destructive hover:bg-destructive/90'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {confirmDialog.type === 'execute'
                  ? t('customCommands.execute')
                  : t('customCommands.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Output Modal */}
      {showOutput && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="flex h-[70vh] w-[80vw] max-w-3xl flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">{executingName}</h3>
                {isExecuting && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {t('customCommands.running')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isExecuting && (
                  <button
                    onClick={handleTerminate}
                    className="flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs text-white hover:bg-destructive/90"
                  >
                    <Square className="h-3 w-3" />
                    {t('customCommands.terminate')}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (isExecuting) {
                      handleTerminate();
                    }
                    setShowOutput(false);
                    setOutput([]);
                  }}
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              ref={outputRef}
              className="flex-1 overflow-y-auto bg-black p-4 font-mono text-xs leading-relaxed text-green-400"
            >
              {output.length === 0 && !isExecuting && (
                <div className="text-muted-foreground">{t('status.loading')}</div>
              )}
              {output.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.type === 'stderr'
                      ? 'text-yellow-400'
                      : line.type === 'error'
                        ? 'text-red-400'
                        : line.type === 'close'
                          ? line.data === '0'
                            ? 'text-green-400'
                            : 'text-red-400'
                          : ''
                  }
                >
                  {line.type === 'close'
                    ? line.data === '0'
                      ? t('customCommands.processExitedSuccess')
                      : t('customCommands.processExitedFailed', { code: line.data })
                    : line.type === 'error'
                      ? t('customCommands.error', { message: line.data })
                      : line.data}
                </div>
              ))}
              {isExecuting && (
                <div className="mt-1 animate-pulse text-green-400">▌</div>
              )}
            </div>

            <div className="border-t border-border px-4 py-2 text-right">
              <button
                onClick={() => {
                  if (isExecuting) {
                    handleTerminate();
                  }
                  setShowOutput(false);
                  setOutput([]);
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
              >
                {t('customCommands.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
