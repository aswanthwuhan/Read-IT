import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../core/db';
import HighlightList from './HighlightList';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await flush();
  expect(check()).toBe(true);
}

function noteButton(text = 'Add note'): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`Missing note button: ${text}`);
  return button;
}

beforeEach(async () => {
  await db.open();
  await db.highlights.clear();
  await db.bookmarks.clear();
  await db.highlights.add({
    id: 'highlight-1',
    bookId: 'book-1',
    sentenceIds: ['sentence-1'],
    text: 'A highlighted sentence.',
    color: 'yellow',
    createdAt: 1,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  container.remove();
  await db.delete();
  await db.open();
});

describe('HighlightList note editor focus', () => {
  it('focuses the textarea and returns focus to the replacement trigger on Escape', async () => {
    await act(async () => root?.render(<HighlightList bookId="book-1" onJump={vi.fn()} />));
    await waitFor(() => container.textContent?.includes('A highlighted sentence.') === true);
    const opener = noteButton();
    act(() => opener.click());

    const editor = container.querySelector<HTMLElement>('.hl-note-editor');
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(editor).not.toBeNull();
    expect(editor?.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement).toBe(textarea);

    act(() => {
      textarea?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(container.querySelector('.hl-note-editor')).toBeNull();
    const replacement = noteButton();
    expect(replacement).not.toBe(opener);
    expect(document.activeElement).toBe(replacement);
  });

  it('does not trap focus or Tab while the note editor is open', async () => {
    await act(async () => {
      root?.render(
        <>
          <HighlightList bookId="book-1" onJump={vi.fn()} />
          <button type="button" data-outside>Outside the editor</button>
        </>,
      );
    });
    await waitFor(() => container.textContent?.includes('A highlighted sentence.') === true);
    act(() => noteButton().click());
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
    const outside = container.querySelector<HTMLButtonElement>('[data-outside]')!;

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      textarea.dispatchEvent(tab);
      outside.focus();
    });

    expect(tab.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(outside);
  });
});
