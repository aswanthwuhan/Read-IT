import { describe, expect, it, vi } from 'vitest';
import {
  createPwaUpdateController,
  createRegisteredPwaUpdates,
  type PwaRegisterCallbacks,
} from './updateState';

function registered() {
  const reloadPage = vi.fn();
  const updateServiceWorker = vi.fn(async () => undefined);
  let callbacks!: PwaRegisterCallbacks;
  const controller = createRegisteredPwaUpdates((options) => {
    callbacks = options;
    return updateServiceWorker;
  }, reloadPage);
  return { controller, callbacks, reloadPage, updateServiceWorker };
}

describe('PWA update state', () => {
  it('shows an available update without reloading and lets the reader choose Later', () => {
    const { controller, callbacks, reloadPage } = registered();

    callbacks.onNeedRefresh?.();
    expect(controller.getSnapshot()).toBe('available');
    expect(reloadPage).not.toHaveBeenCalled();

    controller.later();
    expect(controller.getSnapshot()).toBe('idle');
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('never treats an activated service worker as permission to reload', () => {
    const { controller, callbacks, reloadPage } = registered();

    callbacks.onNeedReload?.();

    expect(controller.getSnapshot()).toBe('ready');
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('waits for activation after Reload now, then reloads exactly once', async () => {
    const { controller, callbacks, reloadPage, updateServiceWorker } = registered();
    callbacks.onNeedRefresh?.();

    controller.reload();
    expect(controller.getSnapshot()).toBe('activating');
    expect(reloadPage).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(updateServiceWorker).toHaveBeenCalledTimes(1);
    expect(updateServiceWorker).toHaveBeenCalledWith(true);

    // A repeated click cannot send a second SKIP_WAITING message.
    controller.reload();
    expect(updateServiceWorker).toHaveBeenCalledTimes(1);

    callbacks.onNeedReload?.();
    expect(controller.getSnapshot()).toBe('idle');
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('reloads immediately when the new worker already controls the page', () => {
    const { controller, callbacks, reloadPage, updateServiceWorker } = registered();
    callbacks.onNeedReload?.();

    controller.reload();

    expect(controller.getSnapshot()).toBe('idle');
    expect(reloadPage).toHaveBeenCalledTimes(1);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('returns to the available state if requesting activation fails', async () => {
    const reloadPage = vi.fn();
    const updateServiceWorker = vi.fn(async () => {
      throw new Error('worker disappeared');
    });
    const controller = createPwaUpdateController({ updateServiceWorker, reloadPage });
    controller.needRefresh();

    controller.reload();
    await vi.waitFor(() => expect(controller.getSnapshot()).toBe('available'));

    expect(reloadPage).not.toHaveBeenCalled();
    controller.reload();
    await vi.waitFor(() => expect(updateServiceWorker).toHaveBeenCalledTimes(2));
  });
});
