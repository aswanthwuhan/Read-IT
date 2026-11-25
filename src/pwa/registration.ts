/// <reference types="vite-plugin-pwa/client" />

import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  createPwaUpdateController,
  createRegisteredPwaUpdates,
  type PwaUpdateController,
  type PwaUpdateState,
} from './updateState';

let updates: PwaUpdateController | null = null;

/**
 * Register once per document, including React StrictMode's effect replay.
 * Native builds ship no service worker; dev leaves PWA generation disabled.
 */
export function registerPwaUpdates(): PwaUpdateController {
  if (updates) return updates;

  if (!import.meta.env.PROD || import.meta.env.MODE === 'native' || !('serviceWorker' in navigator)) {
    updates = createPwaUpdateController({
      updateServiceWorker: () => Promise.resolve(),
      reloadPage: () => window.location.reload(),
    });
    return updates;
  }

  updates = createRegisteredPwaUpdates(registerSW, () => window.location.reload());
  return updates;
}

export function usePwaUpdates(): {
  state: PwaUpdateState;
  reload: () => void;
  later: () => void;
} {
  const [state, setState] = useState<PwaUpdateState>('idle');

  useEffect(() => {
    const controller = registerPwaUpdates();
    const sync = () => setState(controller.getSnapshot());
    sync();
    return controller.subscribe(sync);
  }, []);

  return {
    state,
    reload: () => updates?.reload(),
    later: () => updates?.later(),
  };
}
