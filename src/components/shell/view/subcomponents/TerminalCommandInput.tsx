import { useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TerminalCommandInputProps = {
  disabled?: boolean;
  onSend: (command: string) => void;
};

export default function TerminalCommandInput({
  disabled = false,
  onSend,
}: TerminalCommandInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const submit = useCallback(() => {
    const command = value;
    if (!command.trim() || disabled) {
      return;
    }
    onSend(command);
    setValue('');
  }, [disabled, onSend, value]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-shrink-0 items-center gap-2 border-t border-gray-700/80 bg-gray-900 px-2 py-2"
    >
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={t('terminalPanel.commandPlaceholder', 'Enter command…')}
        className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 font-mono text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        title={t('terminalPanel.send', 'Send')}
      >
        <Send className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('terminalPanel.send', 'Send')}</span>
      </button>
    </form>
  );
}
