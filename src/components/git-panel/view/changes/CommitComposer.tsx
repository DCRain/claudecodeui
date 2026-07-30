import { Check, ChevronDown, GitCommit } from 'lucide-react';
import { useState } from 'react';
import type { ConfirmationRequest } from '../../types/types';

// Persists commit messages across unmount/remount, keyed by project path
const commitMessageCache = new Map<string, string>();

type CommitComposerProps = {
  isMobile: boolean;
  projectPath: string;
  selectedFileCount: number;
  isHidden: boolean;
  onCommit: (message: string) => Promise<boolean>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
  error?: string;
  onClearError?: () => void;
};

export default function CommitComposer({
  isMobile,
  projectPath,
  selectedFileCount,
  isHidden,
  onCommit,
  onRequestConfirmation,
  error,
  onClearError,
}: CommitComposerProps) {
  const [commitMessage, setCommitMessageRaw] = useState(() => commitMessageCache.get(projectPath) ?? '');

  const setCommitMessage = (msg: string) => {
    setCommitMessageRaw(msg);
    if (error && onClearError) {
      onClearError();
    }
    if (msg) {
      commitMessageCache.set(projectPath, msg);
    } else {
      commitMessageCache.delete(projectPath);
    }
  };

  const [isCommitting, setIsCommitting] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(isMobile);
  const [noVerify, setNoVerify] = useState(true);

  const handleCommit = async (message = commitMessage) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || selectedFileCount === 0 || isCommitting) {
      return false;
    }

    setIsCommitting(true);
    try {
      const success = await onCommit(trimmedMessage, noVerify);
      if (success) {
        setCommitMessage('');
      }
      return success;
    } finally {
      setIsCommitting(false);
    }
  };

  const requestCommitConfirmation = () => {
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage || selectedFileCount === 0 || isCommitting) {
      return;
    }

    onRequestConfirmation({
      type: 'commit',
      message: `Commit ${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''} with message: "${trimmedMessage}"?`,
      onConfirm: async () => {
        await handleCommit(trimmedMessage);
      },
    });
  };

  return (
    <div
      className={`transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-96 translate-y-0 opacity-100'
      }`}
    >
      {isMobile && isCollapsed ? (
        <div className="border-b border-border/60 px-4 py-2">
          <button
            onClick={() => setIsCollapsed(false)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <GitCommit className="h-4 w-4" />
            <span>Commit {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div className="border-b border-border/60 px-4 py-3">
          {isMobile && (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Commit Changes</span>
              <button
                onClick={() => setIsCollapsed(true)}
                className="rounded-lg p-1 transition-colors hover:bg-accent"
              >
                <ChevronDown className="h-4 w-4 rotate-180" />
              </button>
            </div>
          )}

          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
            rows={3}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleCommit();
              }
            }}
          />

          <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={noVerify}
              onChange={(e) => setNoVerify(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border bg-background accent-primary"
            />
            <Shield className="h-3 w-3" />
            Skip lint hooks
          </label>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={requestCommitConfirmation}
              disabled={!commitMessage.trim() || selectedFileCount === 0 || isCommitting}
              className="flex items-center space-x-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              <span>{isCommitting ? 'Committing...' : 'Commit'}</span>
            </button>
          </div>

          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span className="flex-1 leading-relaxed">{error}</span>
              {onClearError && (
                <button
                  onClick={onClearError}
                  className="shrink-0 rounded p-0.5 hover:bg-destructive/20"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
