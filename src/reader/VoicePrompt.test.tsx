import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBackBridge } from '../core/backButton';
import { db } from '../core/db';
import { getSetting, setSetting } from '../core/settings';
import { resetDownload, startDownload } from '../tts/downloads';
import VoicePrompt from './VoicePrompt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../core/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/settings')>();
  return { ...actual, setSetting: vi.fn(actual.setSetting) };
});

const offer = vi.hoisted(() => ({ start: vi.fn<() => Promise<void>>() }));
// The real module keeps the copy in one place; only the download is replaced.
vi.mock('../tts/kokoroOffer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tts/kokoroOffer')>();
  return { ...actual, startKokoroDownload: offer.start };
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function useUserAgent(userAgent: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
}

let container: HTMLDivElement;
let root: Root | null = null;
const onClose = vi.fn();

async function mount(open = true): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<VoicePrompt open={open} onClose={onClose} />);
  });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check() && Date.now() < deadline) {
    await flush(20);
  }
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === text);
}

async function finishDownload(): Promise<void> {
  await act(async () => {
    await startDownload('kokoro', async () => {
      // The real path prepares the model here; the sheet only watches `done`.
    });
  });
}

beforeEach(() => {
  onClose.mockClear();
  offer.start.mockReset();
  vi.mocked(setSetting).mockClear();
  resetDownload('kokoro');
  useUserAgent(DESKTOP_UA);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  container.remove();
  resetDownload('kokoro');
  await flush(10);
  await db.delete();
  await db.open();
});

describe('VoicePrompt', () => {
  it('focuses the primary action, contains Tab, repairs body focus, and handles Escape', async () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    document.body.append(opener);
    opener.focus();
    const previousBodyTabIndex = document.body.getAttribute('tabindex');
    document.body.tabIndex = -1;
    try {
      await mount();
      const start = buttonWithText('Download Kokoro')!;
      const secondary = buttonWithText('Not now')!;
      expect(document.activeElement).toBe(start);

      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      await act(async () => start.dispatchEvent(tab));
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(secondary);

      const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      await act(async () => secondary.dispatchEvent(shiftTab));
      expect(shiftTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(start);

      await act(async () => document.body.focus());
      expect(document.activeElement).toBe(start);

      await act(async () => {
        start.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      if (previousBodyTabIndex === null) document.body.removeAttribute('tabindex');
      else document.body.setAttribute('tabindex', previousBodyTabIndex);
      opener.remove();
    }
  });

  it('returns focus to its opener when the sheet closes', async () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    document.body.append(opener);
    opener.focus();
    try {
      await mount();
      expect(document.activeElement).toBe(buttonWithText('Download Kokoro'));

      await act(async () => root?.render(<VoicePrompt open={false} onClose={onClose} />));

      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('keeps its Android back handler above navigation while open', async () => {
    const navigate = vi.fn();
    const dispose = installBackBridge(navigate, () => '/read/book-1');
    try {
      await mount();
      let handled = false;
      await act(async () => {
        handled = window.__readitBack?.() ?? false;
      });
      expect(handled).toBe(true);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();

      await act(async () => root?.render(<VoicePrompt open={false} onClose={onClose} />));
      await act(async () => {
        handled = window.__readitBack?.() ?? false;
      });
      expect(handled).toBe(true);
      expect(navigate).toHaveBeenCalledWith('/');
    } finally {
      dispose();
    }
  });

  it('explains the offer with the size from the code and a way out', async () => {
    await mount();

    const sheet = container.querySelector('[role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain('Kokoro is a higher quality voice than the phone voice');
    expect(sheet!.textContent).toContain('Download it once (320 MB)');
    expect(sheet!.textContent).toContain(
      'Every downloadable voice is listed and can be tested in Settings → On-device voice models.'
    );
    expect(buttonWithText('Download Kokoro')).toBeDefined();
    expect(buttonWithText('Not now')).toBeDefined();

    await act(async () => {
      buttonWithText('Not now')!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows progress with a text value and closes without cancelling the download', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    offer.start.mockImplementation(() =>
      startDownload('kokoro', async (report) => {
        report({ fraction: 0.42 });
        await gate;
      })
    );
    await mount();

    await act(async () => {
      buttonWithText('Download Kokoro')!.click();
    });
    await waitFor(() => container.textContent?.includes('Downloading Kokoro — 42%') === true);

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    expect(container.textContent).toContain('You can close this and keep reading');

    await act(async () => {
      buttonWithText('Close')!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    finish();
    await flush(10);
  });

  it('switches the engine to Kokoro when the download finishes', async () => {
    offer.start.mockImplementation(() =>
      startDownload('kokoro', async () => {
        // The real path prepares the model here; the sheet only watches `done`.
      })
    );
    await mount();

    await act(async () => {
      buttonWithText('Download Kokoro')!.click();
    });
    await waitFor(() => container.textContent?.includes('Kokoro is ready') === true, 4000);

    expect(await getSetting('tts.engine', 'auto')).toBe('kokoro');
    expect(container.textContent).toContain('It will read from here');
  });

  it('waits for persistence before closing an already downloaded voice', async () => {
    await finishDownload();
    await mount();
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(setSetting).mockImplementationOnce(() => saved);

    const useKokoro = buttonWithText('Use Kokoro')!;
    await act(async () => {
      useKokoro.click();
      useKokoro.click();
      buttonWithText('Not now')!.click();
      container.querySelector<HTMLElement>('.sheet-backdrop')!.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(setSetting).toHaveBeenCalledWith('tts.engine', 'kokoro');
    expect(onClose).not.toHaveBeenCalled();
    expect(useKokoro.disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('Selecting Kokoro…');
    expect(container.textContent).not.toContain('It will read from here');

    await act(async () => finish());
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an already downloaded voice available when selecting it fails', async () => {
    await finishDownload();
    await mount();
    vi.mocked(setSetting).mockRejectedValueOnce(new Error('Storage is full'));

    await act(async () => {
      buttonWithText('Use Kokoro')!.click();
    });
    await flush();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Couldn’t switch to Kokoro');
    expect(alert?.textContent).toContain('Your reading voice hasn’t changed');
    expect(alert?.textContent).not.toContain('Storage is full');
    expect(onClose).not.toHaveBeenCalled();
    expect(await getSetting('tts.engine', 'auto')).toBe('auto');

    const retry = buttonWithText('Use Kokoro')!;
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
      retry.click();
    });
    await flush();
    expect(setSetting).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await getSetting('tts.engine', 'auto')).toBe('kokoro');
  });

  it('does not claim the automatic voice switch succeeded until it is stored', async () => {
    offer.start.mockImplementation(() =>
      startDownload('kokoro', async () => {
        // The real path prepares the model here; the sheet only watches `done`.
      })
    );
    let reject!: (reason: unknown) => void;
    const saved = new Promise<void>((_, fail) => {
      reject = fail;
    });
    vi.mocked(setSetting).mockImplementationOnce(() => saved);
    await mount();

    await act(async () => {
      buttonWithText('Download Kokoro')!.click();
    });
    await waitFor(() => buttonWithText('Selecting Kokoro…') !== undefined, 4000);
    expect(container.textContent).not.toContain('Kokoro is ready');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => reject(new Error('Storage is full')));
    await waitFor(() => container.querySelector('[role="alert"]') !== null, 4000);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t switch to Kokoro');
    expect(container.textContent).not.toContain('Kokoro is ready');
    expect(onClose).not.toHaveBeenCalled();
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(await getSetting('tts.engine', 'auto')).toBe('auto');
  });

  it('keeps the phone voice when the download fails and offers a retry', async () => {
    offer.start.mockImplementation(() =>
      startDownload('kokoro', async () => {
        throw new Error('The connection dropped.');
      })
    );
    await mount();

    await act(async () => {
      buttonWithText('Download Kokoro')!.click();
    });
    await waitFor(() => container.textContent?.includes('Kokoro didn’t finish downloading') === true);

    expect(container.textContent).toContain('The connection dropped.');
    expect(container.textContent).toContain('The phone voice is still reading your book');
    expect(await getSetting('tts.engine', 'auto')).toBe('auto');
    expect(buttonWithText('Retry')).toBeDefined();

    await act(async () => {
      buttonWithText('Retry')!.click();
    });
    expect(offer.start).toHaveBeenCalledTimes(2);
  });

  it('adds the iPhone line about the phone voice, above the buttons', async () => {
    useUserAgent(IPHONE_UA);
    await mount();

    const sheet = container.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain(
      'The phone voice may not start on iPhone and iPad, so Kokoro is recommended.'
    );
    // Above the buttons, and inside the sheet's own copy.
    const line = sheet.querySelector('.voice-prompt-ios');
    const actions = sheet.querySelector('.voice-prompt-actions');
    expect(line).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(
      line!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps the sheet copy unchanged away from iOS', async () => {
    await mount();

    expect(container.querySelector('.voice-prompt-ios')).toBeNull();
  });
});

