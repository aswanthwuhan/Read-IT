import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PwaUpdateBannerView from './PwaUpdateBannerView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let trigger: HTMLButtonElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  trigger = document.createElement('button');
  trigger.textContent = 'Keep reading';
  document.body.append(trigger, container);
  trigger.focus();
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  trigger.remove();
  vi.restoreAllMocks();
});

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
}

describe('PwaUpdateBannerView', () => {
  it('keeps the live region mounted across updates and steals no focus', async () => {
    await act(async () => root.render(<PwaUpdateBannerView state="idle" onReload={vi.fn()} onLater={vi.fn()} />));

    const live = container.querySelector('[role="status"]');
    expect(live?.textContent).toBe('');
    expect(container.querySelector('section')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () =>
      root.render(<PwaUpdateBannerView state="available" onReload={vi.fn()} onLater={vi.fn()} />),
    );

    expect(container.querySelector('[role="status"]')).toBe(live);
    expect(live?.textContent).toContain('Update available');
    expect(document.activeElement).toBe(trigger);
  });

  it('is a non-modal banner with explicit Reload now and Later actions', async () => {
    const onReload = vi.fn();
    const onLater = vi.fn();
    await act(async () =>
      root.render(<PwaUpdateBannerView state="available" onReload={onReload} onLater={onLater} />),
    );

    const banner = container.querySelector('section');
    expect(banner?.getAttribute('data-state')).toBe('available');
    expect(banner?.getAttribute('aria-modal')).toBeNull();
    expect(container.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Update available');

    await act(async () => button('Later')!.click());
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    await act(async () => button('Reload now')!.click());
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while the chosen update is activating', async () => {
    await act(async () =>
      root.render(<PwaUpdateBannerView state="activating" onReload={vi.fn()} onLater={vi.fn()} />),
    );

    expect(button('Reload now')?.disabled).toBe(true);
    expect(button('Later')?.disabled).toBe(true);
    expect(container.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
  });
});
