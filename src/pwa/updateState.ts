export type PwaUpdateState = 'idle' | 'available' | 'activating' | 'ready';

export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export interface PwaUpdateController {
  getSnapshot: () => PwaUpdateState;
  subscribe: (listener: () => void) => () => void;
  needRefresh: () => void;
  needReload: () => void;
  reload: () => void;
  later: () => void;
}

export interface PwaUpdateControllerOptions {
  updateServiceWorker: UpdateServiceWorker;
  reloadPage: () => void;
}

/**
 * The service worker never reloads this page on its own. `ready` still shows a
 * banner; only an explicit Reload now click can reach `reloadPage`.
 */
export function createPwaUpdateController({
  updateServiceWorker,
  reloadPage,
}: PwaUpdateControllerOptions): PwaUpdateController {
  let state: PwaUpdateState = 'idle';
  let reloadRequested = false;
  const listeners = new Set<() => void>();

  function setState(next: PwaUpdateState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A broken subscriber must not block the update hand-off.
      }
    }
  }

  function needRefresh(): void {
    if (state !== 'activating') setState('available');
  }

  function needReload(): void {
    if (!reloadRequested) {
      setState('ready');
      return;
    }
    reloadRequested = false;
    setState('idle');
    reloadPage();
  }

  function reload(): void {
    if (state === 'idle' || state === 'activating') return;
    if (state === 'ready') {
      setState('idle');
      reloadPage();
      return;
    }

    reloadRequested = true;
    setState('activating');
    void Promise.resolve()
      .then(() => updateServiceWorker(true))
      .catch(() => {
        reloadRequested = false;
        setState('available');
      });
  }

  function later(): void {
    // Once SKIP_WAITING has been sent, activation is already in motion.
    if (state === 'activating') return;
    setState('idle');
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    needRefresh,
    needReload,
    reload,
    later,
  };
}

export interface PwaRegisterCallbacks {
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
}

export type PwaRegister = (callbacks: PwaRegisterCallbacks) => UpdateServiceWorker;

/** Wire virtual:pwa-register's two callbacks into the explicit-reload state machine. */
export function createRegisteredPwaUpdates(
  register: PwaRegister,
  reloadPage: () => void,
): PwaUpdateController {
  let updateServiceWorker: UpdateServiceWorker = () => Promise.resolve();
  const controller = createPwaUpdateController({
    updateServiceWorker: (reloadPage) => updateServiceWorker(reloadPage),
    reloadPage,
  });

  updateServiceWorker = register({
    onNeedRefresh: controller.needRefresh,
    onNeedReload: controller.needReload,
  });
  return controller;
}
