import { useEffect, useRef, type RefObject } from 'react';

export type FocusGuardMode = 'modal' | 'popover';

export interface FocusGuardOptions {
  active: boolean;
  mode?: FocusGuardMode;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
}

interface Guard {
  id: number;
  root: HTMLElement;
  mode: FocusGuardMode;
  escape(): void;
}

/** Newest unrelated guard wins; a guard nested inside another is always above it. */
const guards: Guard[] = [];
let nextGuardId = 1;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

function isHidden(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return true;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return true;
    }
  }
  return false;
}

function isDisabled(element: HTMLElement): boolean {
  return element.matches(':disabled') || element.getAttribute('type') === 'hidden';
}

function isAvailable(element: HTMLElement | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && !isHidden(element) && !isDisabled(element);
}

function isTabbable(element: HTMLElement): boolean {
  return element.tabIndex >= 0 || element.matches('[contenteditable="true"]');
}

function canFocus(element: HTMLElement | null): element is HTMLElement {
  return isAvailable(element) && (isTabbable(element) || element.hasAttribute('tabindex'));
}

function focus(element: HTMLElement | null): boolean {
  if (!canFocus(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => isAvailable(element) && isTabbable(element),
  );
}

function isAbove(candidate: Guard, other: Guard): boolean {
  if (candidate.root === other.root) return candidate.id > other.id;
  if (candidate.root.contains(other.root)) return true;
  return !other.root.contains(candidate.root) && other.id > candidate.id;
}

function isTop(guard: Guard): boolean {
  return (
    guard.root.isConnected &&
    guards.every(
      (other) => other === guard || !other.root.isConnected || !isAbove(guard, other),
    )
  );
}

function hasFocusSuccessor(guard: Guard): boolean {
  return guards.some((other) => {
    if (other === guard || !other.root.isConnected) return false;
    if (guard.root === other.root) return other.id > guard.id;
    if (guard.root.contains(other.root)) return true;
    return !other.root.contains(guard.root) && other.id > guard.id;
  });
}

/**
 * Move focus into a dialog or popover while it is active. Modal guards contain
 * Tab and repair focus that escapes to the page; popovers only focus in and
 * return focus on close. Neither mode changes the element's ARIA role.
 */
export function useFocusGuard({
  active,
  mode = 'modal',
  containerRef,
  initialFocusRef,
  returnFocusRef,
  onEscape,
}: FocusGuardOptions): void {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !(container instanceof HTMLElement)) return;
    const root: HTMLElement = container;

    const guard: Guard = {
      id: nextGuardId++,
      root,
      mode,
      escape: () => escapeRef.current?.(),
    };
    guards.push(guard);

    const explicitOpener = returnFocusRef?.current;
    const opener =
      explicitOpener instanceof HTMLElement
        ? explicitOpener
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    let lastFocused: HTMLElement | null = null;

    const items = (): HTMLElement[] => focusables(root);

    const hasValidFocus = (): boolean => {
      const current = document.activeElement;
      return (
        root.isConnected &&
        current instanceof HTMLElement &&
        root.contains(current) &&
        canFocus(current)
      );
    };

    const repair = (): void => {
      if (!isTop(guard) || !root.isConnected || hasValidFocus()) return;
      const available = items();
      const preferred = lastFocused && available.includes(lastFocused) ? lastFocused : available[0];
      if (preferred) focus(preferred);
      else focus(root);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !isTop(guard)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        guard.escape();
        return;
      }
      if (guard.mode !== 'modal' || event.key !== 'Tab') return;

      const available = items();
      const first = available[0];
      const last = available[available.length - 1];
      if (!first || !last) {
        if (canFocus(root)) {
          event.preventDefault();
          focus(root);
        }
        return;
      }

      const current = document.activeElement;
      const inside = current instanceof Node && root.contains(current);
      const atBoundary = event.shiftKey ? current === first : current === last;
      if (atBoundary || !inside || (current instanceof HTMLElement && !available.includes(current))) {
        event.preventDefault();
        focus(event.shiftKey ? last : first);
      }
    };

    const onFocusIn = (event: FocusEvent): void => {
      if (!isTop(guard)) return;
      const target = event.target;
      if (target instanceof HTMLElement && root.contains(target) && canFocus(target)) {
        lastFocused = target;
        return;
      }
      // Focus can land on body when the focused control is removed, or be moved
      // there programmatically. Pull it back without interfering with a nested guard.
      if (guard.mode === 'modal') repair();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn, true);
    const observer = new MutationObserver(repair);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'inert',
        'aria-hidden',
        'tabindex',
        'style',
        'class',
        'type',
        'contenteditable',
      ],
    });

    if (isTop(guard)) {
      const initial = initialFocusRef?.current ?? null;
      if (!(initial instanceof HTMLElement && root.contains(initial) && focus(initial))) {
        // A focusable container is a useful landing point for text-first sheets;
        // otherwise start at their first available control.
        if (!focus(root)) focus(items()[0] ?? null);
      }
    }

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn, true);
      const at = guards.indexOf(guard);
      if (at !== -1) guards.splice(at, 1);
      if (hasFocusSuccessor(guard)) return;
      // The trigger may have been replaced while the editor was open (as happens
      // in the highlights list), so prefer its current ref over the captured node.
      const returnTo = returnFocusRef?.current ?? opener;
      if (returnTo?.isConnected) focus(returnTo);
    };
  }, [active, mode, containerRef, initialFocusRef, returnFocusRef]);
}
