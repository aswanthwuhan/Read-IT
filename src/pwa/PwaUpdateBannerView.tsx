import type { PwaUpdateState } from './updateState';
import styles from './PwaUpdateBanner.module.css';

const COPY: Record<Exclude<PwaUpdateState, 'idle'>, { title: string; body: string }> = {
  available: {
    title: 'Update available',
    body: 'Reload when you’re finished with playback, imports, downloads and backups.',
  },
  activating: {
    title: 'Applying update…',
    body: 'This page will reload when the new version is ready.',
  },
  ready: {
    title: 'Update ready',
    body: 'Reload when you’re finished with playback, imports, downloads and backups.',
  },
};

export interface PwaUpdateBannerViewProps {
  state: PwaUpdateState;
  onReload: () => void;
  onLater: () => void;
}

/** Presentational surface kept separate so the no-focus/no-modal contract is testable. */
export default function PwaUpdateBannerView({ state, onReload, onLater }: PwaUpdateBannerViewProps) {
  const activating = state === 'activating';
  const copy = state === 'idle' ? null : COPY[state];

  return (
    <>
      {/* Keep the live region mounted and empty so the first update is announced. */}
      <div className={styles.live} role="status" aria-live="polite" aria-atomic="true">
        {copy ? `${copy.title}. ${copy.body}` : ''}
      </div>
      {copy ? (
        <section
          className={`banner banner-info ${styles.root}`}
          aria-labelledby="pwa-update-title"
          aria-busy={activating}
          data-state={state}
        >
          <div className={styles.body}>
            <p className="banner-title" id="pwa-update-title">
              {copy.title}
            </p>
            <p>{copy.body}</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={onReload} disabled={activating}>
              Reload now
            </button>
            <button type="button" className="btn btn-ghost" onClick={onLater} disabled={activating}>
              Later
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
