import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { HighlightColor } from './SelectionBar';
import SelectionBar from './SelectionBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler<A extends unknown[] = []> = ReturnType<typeof vi.fn<(...args: A) => void>>;

interface BarProps {
  onPlay: Handler;
  onHighlight: Handler<[HighlightColor]>;
  onNote: ReturnType<typeof vi.fn<(note: string) => Promise<boolean>>>;
  onBookmark: Handler;
  onCard: Handler<['qa' | 'cloze']>;
  onAi: Handler;
  onExtend: Handler;
  onClose: Handler;
}

function renderBar(overrides: Partial<BarProps> = {}): { container: HTMLDivElement; root: Root; props: BarProps } {
  const props: BarProps = {
    onPlay: vi.fn(),
    onHighlight: vi.fn(),
    onNote: vi.fn().mockResolvedValue(true),
    onBookmark: vi.fn(),
    onCard: vi.fn(),
    onAi: vi.fn(),
    onExtend: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SelectionBar text="Absorption is the first step." count={1} canExtend {...props} />);
  });
  return { container, root, props };
}

describe('SelectionBar', () => {
  it('focuses the toolbar and labels every action', () => {
    const { container, root } = renderBar();
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Actions for 1 selected sentence');
    expect(document.activeElement).toBe(dialog);

    const labels = [...container.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['Yellow highlight', 'Green highlight', 'Blue highlight', 'Pink highlight', 'Close actions']));
    expect(labels).toContain('Play selection');
    act(() => root.unmount());
  });

  it('plays the selected sentences', () => {
    const { container, root, props } = renderBar();
    const play = container.querySelector<HTMLButtonElement>('[aria-label="Play selection"]');
    expect(play?.textContent).toContain('Play');
    act(() => {
      play?.click();
    });
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('closes on Escape', () => {
    const { container, root, props } = renderBar();
    const dialog = container.querySelector('[role="dialog"]');
    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('lets Escape cancel the note without closing the selection toolbar', () => {
    const { container, root, props } = renderBar();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Note')?.click();
    });
    const note = container.querySelector<HTMLTextAreaElement>('#rd-note')!;
    expect(document.activeElement).toBe(note);

    act(() => {
      note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(props.onClose).not.toHaveBeenCalled();
    expect(container.querySelector('#rd-note')).toBeNull();
    expect(document.activeElement).toBe(dialog);

    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Note')?.click();
    });
    expect(container.querySelector<HTMLTextAreaElement>('#rd-note')?.value).toBe('');
    act(() => root.unmount());
  });

  it('reports the chosen colour and then the note', async () => {
    const { container, root, props } = renderBar();

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Green highlight"]')?.click();
    });
    expect(props.onHighlight).toHaveBeenCalledWith('green');

    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Note')?.click();
    });
    const note = container.querySelector<HTMLTextAreaElement>('#rd-note');
    expect(note).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(note, '  remember this  ');
      note?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(props.onNote).toHaveBeenCalledWith('remember this');
    act(() => root.unmount());
  });

  it('keeps the draft available to retry when the save fails', async () => {
    const onNote = vi.fn<(note: string) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { container, root } = renderBar({ onNote });
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Note')?.click();
    });
    const note = container.querySelector<HTMLTextAreaElement>('#rd-note');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    act(() => {
      setValue?.call(note, 'Keep this draft');
      note?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form');
    await act(async () => form?.requestSubmit());
    expect(note?.value).toBe('Keep this draft');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not save the note');

    await act(async () => form?.requestSubmit());
    expect(onNote.mock.calls).toEqual([['Keep this draft'], ['Keep this draft']]);
    expect(container.querySelector('form')).toBeNull();
    act(() => root.unmount());
  });
});
