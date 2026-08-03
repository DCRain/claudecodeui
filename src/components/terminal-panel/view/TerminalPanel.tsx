import { useCallback, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { HOME_TERMINAL_PROJECT } from '../constants';

type TerminalTab = {
  id: string;
  labelNumber: number;
};

function createTab(labelNumber: number, idPrefix: string): TerminalTab {
  return {
    // Keep ids filesystem/PTY-key safe (alphanumeric + hyphen/underscore).
    id: `${idPrefix}${labelNumber}${Math.random().toString(36).slice(2, 9)}`,
    labelNumber,
  };
}

type TerminalPanelProps = {
  /** When true, fills the available area without relying on parent absolute layout. */
  className?: string;
};

export default function TerminalPanel({ className = '' }: TerminalPanelProps) {
  const { t } = useTranslation();
  const idPrefix = useId().replace(/[^a-zA-Z0-9]/g, '') || 'term';
  const initialTabRef = useRef<TerminalTab | null>(null);
  if (!initialTabRef.current) {
    initialTabRef.current = createTab(1, idPrefix);
  }

  const [tabs, setTabs] = useState<TerminalTab[]>([initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState(initialTabRef.current.id);
  const [nextLabel, setNextLabel] = useState(2);

  const handleAddTab = useCallback(() => {
    const tab = createTab(nextLabel, idPrefix);
    setNextLabel((value) => value + 1);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [idPrefix, nextLabel]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          return prev;
        }

        const index = prev.findIndex((tab) => tab.id === tabId);
        if (index < 0) {
          return prev;
        }

        const nextTabs = prev.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
          setActiveTabId(fallback.id);
        }
        return nextTabs;
      });
    },
    [activeTabId],
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden ${className}`}>
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/60 bg-muted/20 px-2 py-1">
        <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex max-w-[10rem] flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="min-w-0 truncate"
                  title={t('terminalPanel.tabLabel', { number: tab.labelNumber })}
                >
                  {t('terminalPanel.tabLabel', { number: tab.labelNumber })}
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleCloseTab(tab.id)}
                    className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                    aria-label={t('terminalPanel.closeTab')}
                    title={t('terminalPanel.closeTab')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleAddTab}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('terminalPanel.newTab')}
          title={t('terminalPanel.newTab')}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Mount only the active shell so xterm opens in a sized, visible container. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab && (
          <StandaloneShell
            key={activeTab.id}
            project={HOME_TERMINAL_PROJECT}
            session={null}
            isPlainShell
            showHeader={false}
            isActive
            autoConnect
            clientTerminalId={activeTab.id}
          />
        )}
      </div>
    </div>
  );
}
