import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Chapter } from '../core/types';
import ReflowView from './ReflowView';
import { indexBook } from './sentences';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('reveals and scrolls to a reading position outside the current window', async () => {
  const chapter: Chapter = {
    id: 'ch-0',
    title: 'A long chapter',
    blocks: [{
      id: 'block-0',
      kind: 'p',
      sentences: Array.from({ length: 600 }, (_, index) => ({
        id: `sentence-${index}`,
        text: `Sentence ${index}.`,
      })),
    }],
  };
  const [sentences = []] = indexBook({ title: chapter.title, format: 'txt', chapters: [chapter] }).chapters;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previousScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  const scrolled = vi.fn(function (this: HTMLElement) {
    return this.dataset.sid;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrolled });

  function render(readingId: string) {
    return act(async () => root.render(
      <ReflowView
        chapter={chapter}
        eyebrow="Chapter 1 of 1"
        sentences={sentences}
        readingId={readingId}
        highlights={new Map()}
        selected={[]}
        fontSize={16}
        lineHeight={1.5}
        onTap={() => undefined}
        onSelect={() => undefined}
      />
    ));
  }

  try {
    await render('sentence-0');
    expect(container.querySelector('[data-sid="sentence-500"]')).toBeNull();
    scrolled.mockClear();

    await render('sentence-500');
    expect(scrolled.mock.results[0]?.value).toBe('sentence-500');
    expect(scrolled).toHaveBeenCalledTimes(1);

    await act(async () => container.querySelector<HTMLButtonElement>('.rd-more')?.click());
    expect(scrolled).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
    if (previousScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScrollIntoView);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  }
});
