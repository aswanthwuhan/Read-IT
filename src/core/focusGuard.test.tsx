import { act, useRef, useState, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusGuard, type FocusGuardMode } from './focusGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];

function render(element: React.ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  act(() => root.render(element));
  return {
    container,
    rerender(next: React.ReactNode) {
      act(() => root.render(next));
    },
  };
}

async function flushMutations(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

function pressTab(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
}

interface GuardHarnessProps {
  mode?: FocusGuardMode;
  active?: boolean;
  onEscape?: () => void;
}

function GuardHarness({ mode = 'modal', active = true, onEscape }: GuardHarnessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  useFocusGuard({
    active,
    mode,
    containerRef: rootRef,
    initialFocusRef: firstRef,
    returnFocusRef: openerRef,
    onEscape,
  });

  return (
    <>
      <button ref={openerRef} type="button">Open</button>
      <button type="button" data-outside>Outside</button>
      {active ? (
        <div
          ref={rootRef}
          role={mode === 'modal' ? 'dialog' : 'group'}
          aria-modal={mode === 'modal' ? 'true' : undefined}
          tabIndex={-1}
        >
          <button ref={firstRef} type="button">First</button>
          <button type="button" disabled>Disabled</button>
          <button type="button" hidden>Hidden</button>
          <button type="button" style={{ display: 'none' }}>Styled hidden</button>
          <div hidden><button type="button">Hidden ancestor</button></div>
          <button type="button" tabIndex={-1}>Programmatic only</button>
          <button type="button">Last</button>
          <button type="button" disabled>Disabled last</button>
          <button type="button" hidden>Hidden last</button>
        </div>
      ) : null}
    </>
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  document.body.removeAttribute('tabindex');
});

describe('useFocusGuard modal mode', () => {
  it('focuses in and wraps Tab in both directions, including from the container', () => {
    const { container } = render(<GuardHarness />);
    const root = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const first = buttonWithText(container, 'First');
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
    const last = buttons.find((button) => button.textContent === 'Last')!;

    expect(document.activeElement).toBe(first);
    expect(pressTab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(pressTab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    act(() => root.focus());
    expect(pressTab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    act(() => root.focus());
    expect(pressTab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('pulls focus back from an outside control and from document.body', () => {
    const { container } = render(<GuardHarness />);
    const first = buttonWithText(container, 'First');
    const outside = container.querySelector<HTMLButtonElement>('[data-outside]')!;

    act(() => outside.focus());
    expect(document.activeElement).toBe(first);

    const previousTabIndex = document.body.tabIndex;
    document.body.tabIndex = -1;
    try {
      act(() => document.body.focus());
      expect(document.activeElement).toBe(first);
    } finally {
      document.body.tabIndex = previousTabIndex;
    }
  });

  it('repairs focus when the focused button is replaced', async () => {
    const { container } = render(<GuardHarness />);
    const first = buttonWithText(container, 'First');
    const replacement = document.createElement('button');
    replacement.type = 'button';
    replacement.textContent = 'Replacement';
    expect(document.activeElement).toBe(first);

    act(() => first.replaceWith(replacement));
    await flushMutations();

    expect(document.activeElement).toBe(replacement);
  });

  it('returns focus to a connected opener on close', () => {
    const { container, rerender } = render(<GuardHarness />);
    const opener = container.querySelector<HTMLButtonElement>('button')!;

    rerender(<GuardHarness active={false} />);

    expect(document.activeElement).toBe(opener);
  });

  it('does not focus a disconnected opener on close', () => {
    const { container, rerender } = render(<GuardHarness />);
    const opener = container.querySelector<HTMLButtonElement>('button')!;
    const openerFocus = vi.spyOn(opener, 'focus');
    opener.remove();

    try {
      rerender(<GuardHarness active={false} />);
      expect(openerFocus).not.toHaveBeenCalled();
    } finally {
      // Put the React-owned node back so unmount can remove it normally.
      container.prepend(opener);
    }
  });
});

describe('useFocusGuard popover mode', () => {
  it('focuses in and restores the trigger without trapping focus or claiming aria-modal', () => {
    const { container, rerender } = render(<GuardHarness mode="popover" />);
    const root = container.querySelector<HTMLElement>('[role="group"]')!;
    const opener = container.querySelector<HTMLButtonElement>('button')!;
    const outside = container.querySelector<HTMLButtonElement>('[data-outside]')!;
    const last = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Last',
    )!;

    expect(root.hasAttribute('aria-modal')).toBe(false);
    expect(document.activeElement?.textContent).toBe('First');
    act(() => last.focus());
    expect(pressTab().defaultPrevented).toBe(false);
    act(() => outside.focus());
    expect(document.activeElement).toBe(outside);

    rerender(<GuardHarness mode="popover" active={false} />);
    expect(document.activeElement).toBe(opener);
  });
});

interface NestedHarnessProps {
  onOuterEscape(): void;
  onInnerEscape(): void;
}

function NestedGuard({ onClose, openerRef }: { onClose(): void; openerRef: RefObject<HTMLButtonElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useFocusGuard({
    active: true,
    mode: 'popover',
    containerRef: rootRef,
    initialFocusRef: buttonRef,
    returnFocusRef: openerRef,
    onEscape: onClose,
  });
  return (
    <div ref={rootRef} role="group">
      <button ref={buttonRef} type="button">Nested action</button>
    </div>
  );
}

function NestedHarness({ onOuterEscape, onInnerEscape }: NestedHarnessProps) {
  const [nested, setNested] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  useFocusGuard({
    active: true,
    containerRef: rootRef,
    initialFocusRef: openRef,
    onEscape: onOuterEscape,
  });
  return (
    <div ref={rootRef} role="dialog" aria-modal="true" tabIndex={-1}>
      <button ref={openRef} type="button" onClick={() => setNested(true)}>Open nested</button>
      {nested ? (
        <NestedGuard
          openerRef={openRef}
          onClose={() => {
            onInnerEscape();
            setNested(false);
          }}
        />
      ) : null}
    </div>
  );
}

describe('useFocusGuard Escape stack', () => {
  it('gives a nested guard the first Escape and leaves the outer guard open', () => {
    const onOuterEscape = vi.fn();
    const onInnerEscape = vi.fn();
    const { container } = render(
      <NestedHarness onOuterEscape={onOuterEscape} onInnerEscape={onInnerEscape} />,
    );
    const open = container.querySelector<HTMLButtonElement>('button')!;
    act(() => open.click());
    const nested = container.querySelector<HTMLButtonElement>('button[type="button"]:last-child')!;
    expect(document.activeElement).toBe(nested);

    act(() => nested.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onInnerEscape).toHaveBeenCalledTimes(1);
    expect(onOuterEscape).not.toHaveBeenCalled();
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(open);

    act(() => open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(onOuterEscape).toHaveBeenCalledTimes(1);
    expect(onInnerEscape).toHaveBeenCalledTimes(1);
  });
});
