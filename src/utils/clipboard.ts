/** Last text this app successfully wrote to the clipboard (select-to-copy, etc.). */
let lastWrittenClipboardText = '';

type CloudCliClipboardBridge = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<boolean>;
};

function getDesktopClipboardBridge(): CloudCliClipboardBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const bridge = (window as Window & { cloudcliClipboard?: CloudCliClipboardBridge }).cloudcliClipboard;
  return bridge && typeof bridge.readText === 'function' ? bridge : null;
}

function fallbackCopyToClipboard(text: string): boolean {
  if (!text || typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  lastWrittenClipboardText = text;

  const desktop = getDesktopClipboardBridge();
  if (desktop?.writeText) {
    try {
      await desktop.writeText(text);
      return true;
    } catch {
      // Fall through to browser APIs.
    }
  }

  let copied = false;

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied) {
    copied = fallbackCopyToClipboard(text);
  }

  return copied;
}

type ReadClipboardOptions = {
  /** When false, skip the in-app last-written fallback (use for right-click paste). */
  allowLastWrittenFallback?: boolean;
};

/**
 * Reads clipboard text. Order:
 * 1) Electron desktop IPC (works on LAN IP / non-secure contexts)
 * 2) Browser Clipboard API
 * 3) Last text this app wrote (select-to-copy → paste), unless disabled
 */
export async function readTextFromClipboard(
  options: ReadClipboardOptions = {},
): Promise<string> {
  const allowLastWrittenFallback = options.allowLastWrittenFallback !== false;

  const desktop = getDesktopClipboardBridge();
  if (desktop?.readText) {
    try {
      const text = await desktop.readText();
      if (typeof text === 'string' && text.length > 0) {
        return text;
      }
    } catch {
      // Fall through.
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      if (text) {
        return text;
      }
    }
  } catch {
    // Permission denied / insecure origin.
  }

  return allowLastWrittenFallback ? lastWrittenClipboardText : '';
}
