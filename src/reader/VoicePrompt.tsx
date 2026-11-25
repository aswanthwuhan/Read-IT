/**
 * The in-reader offer for Kokoro: a bottom sheet that can start the on-device
 * download without leaving the book.
 *
 * It is opened from three places — the voice pill while the phone voice reads, the
 * first Play while Kokoro is not downloaded, and the library/reader banner — and it
 * writes the engine choice only after the download reports `done`. Closing the sheet
 * never cancels the download: the state lives in `downloads.ts`, outside React.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { pushBackHandler } from '../core/backButton';
import { useFocusGuard } from '../core/focusGuard';
import { isIos } from '../core/platform';
import { setSetting } from '../core/settings';
import { useDownload } from '../tts/downloads';
import {
  canRunKokoro,
  IOS_KOKORO_SHEET_LINE,
  startKokoroDownload,
  VOICE_LIST_POINTER,
} from '../tts/kokoroOffer';
import { kokoroSizeMb } from '../tts/neural/sizes';
import { ENGINE_SETTING } from '../tts/registry';
import './VoicePrompt.css';

export interface VoicePromptProps {
  /** Mount/display the sheet; `false` keeps the component alive but invisible. */
  open: boolean;
  /** Removes the sheet. Never cancels a running download. */
  onClose: () => void;
}

export default function VoicePrompt({ open, onClose }: VoicePromptProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const download = useDownload('kokoro');
  /** A download was started from this sheet; without it a stale `done` would switch voices. */
  const [attempted, setAttempted] = useState(false);
  const [switchState, setSwitchState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const switchStateRef = useRef(switchState);
  switchStateRef.current = switchState;
  const switchInFlight = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const switched = switchState === 'saved';
  const saving = switchState === 'saving';

  const close = () => {
    // A voice change must settle before the sheet can disappear, so a failed
    // write has somewhere visible to explain itself.
    if (switchStateRef.current === 'saving') return;
    closeRef.current();
  };
  const closeFnRef = useRef(close);
  closeFnRef.current = close;
  useFocusGuard({
    active: open,
    mode: 'modal',
    containerRef: sheetRef,
    initialFocusRef: startRef,
    onEscape: () => closeFnRef.current(),
  });

  const busy = download.status === 'downloading' || download.status === 'unpacking';
  const done = download.status === 'done';
  const failed = download.status === 'error';

  const selectKokoro = useCallback(async (): Promise<boolean> => {
    if (switchInFlight.current) return false;
    switchInFlight.current = true;
    switchStateRef.current = 'saving';
    setSwitchState('saving');
    try {
      await setSetting(ENGINE_SETTING, 'kokoro');
      if (!openRef.current) return false;
      switchStateRef.current = 'saved';
      setSwitchState('saved');
      return true;
    } catch {
      if (openRef.current) {
        switchStateRef.current = 'error';
        setSwitchState('error');
      }
      return false;
    } finally {
      switchInFlight.current = false;
    }
  }, []);

  // The Android back key belongs to the sheet while it is open. Keep this
  // registration separate so newer sheets/popovers remain above it in the stack.
  useEffect(() => {
    if (!open) return;
    const dispose = pushBackHandler(() => {
      closeFnRef.current();
      return true;
    });

    return dispose;
  }, [open]);

  // A finished download becomes the reading voice, and the sheet says so only
  // after the choice has been stored.
  useEffect(() => {
    if (!open || !attempted || !done || switchState !== 'idle') return;
    void selectKokoro();
  }, [open, attempted, done, switchState, selectKokoro]);

  // A closed sheet forgets its attempt once the download is no longer running,
  // so reopening offers the normal state instead of stale progress or success.
  useEffect(() => {
    if (open) return;
    switchStateRef.current = 'idle';
    setSwitchState('idle');
    if (download.status !== 'downloading' && download.status !== 'unpacking') {
      setAttempted(false);
    }
  }, [open, download.status]);

  useEffect(() => {
    if (!open || !switched) return;
    const timer = window.setTimeout(() => closeFnRef.current(), 1800);
    return () => window.clearTimeout(timer);
  }, [open, switched]);

  if (!open) return null;

  // On an iPhone the phone voice may never start, which is the other half of the
  // reason to offer Kokoro here — but only where Kokoro can actually run.
  const ios = isIos();
  const kokoroRuns = canRunKokoro();
  const phoneVoiceWarning = ios && kokoroRuns && !switched && !done;

  const percent = Math.max(0, Math.min(100, Math.round(download.fraction * 100)));
  const stageText =
    download.stage === 'unpack'
      ? `Unpacking Kokoro — ${percent}%`
      : download.stage === 'load'
        ? 'Loading Kokoro — almost done.'
        : `Downloading Kokoro — ${percent}%`;

  const start = () => {
    setAttempted(true);
    switchStateRef.current = 'idle';
    setSwitchState('idle');
    void startKokoroDownload();
  };

  const useDownloaded = async (): Promise<void> => {
    if (await selectKokoro()) close();
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={close} />
      <div
        ref={sheetRef}
        className="sheet voice-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={saving}
        tabIndex={-1}
      >
        <h2 id={titleId} className="sheet-title">
          Kokoro, the natural voice
        </h2>

        <div className="voice-prompt-body">
          {switched ? (
            <p className="voice-prompt-status" role="status">
              Kokoro is ready. It will read from here.
            </p>
          ) : done ? (
            saving ? (
              <p className="voice-prompt-status" role="status">
                Selecting Kokoro…
              </p>
            ) : (
              <>
                <p className="voice-prompt-status" role="status">
                  Kokoro is already downloaded on this device.
                </p>
                <p className="voice-prompt-note">You can start reading with it straight away.</p>
              </>
            )
          ) : failed ? (
            <>
              <p className="voice-prompt-status" role="alert">
                Kokoro didn’t finish downloading.
              </p>
              {download.error ? <p className="voice-prompt-note">{download.error}</p> : null}
              <p className="voice-prompt-note">
                The phone voice is still reading your book. You can try again.
              </p>
            </>
          ) : busy ? (
            <>
              <p className="voice-prompt-progress-label">{stageText}</p>
              <div
                className="progress voice-prompt-progress"
                role="progressbar"
                aria-label="Kokoro download progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <p className="voice-prompt-note">
                You can close this and keep reading. The download continues.
              </p>
            </>
          ) : (
            <>
              <p>
                Kokoro is a higher quality voice than the phone voice, and it sounds more natural
                reading a whole chapter.
              </p>
              <p>
                It runs on this device. Download it once ({kokoroSizeMb()} MB), and it works
                offline from then on.
              </p>
              <p className="voice-prompt-note">{VOICE_LIST_POINTER}</p>
            </>
          )}
          {phoneVoiceWarning ? (
            <p className="voice-prompt-note voice-prompt-ios">{IOS_KOKORO_SHEET_LINE}</p>
          ) : null}
          {switchState === 'error' ? (
            <p className="voice-prompt-status" role="alert">
              Couldn’t switch to Kokoro. Your reading voice hasn’t changed. Please try again.
            </p>
          ) : null}
        </div>

        <div className="sheet-actions voice-prompt-actions">
          {switched ? (
            <button type="button" className="btn btn-secondary" onClick={close}>
              Close
            </button>
          ) : done ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={close} disabled={saving}>
                Not now
              </button>
              <button
                ref={startRef}
                type="button"
                className="btn btn-primary"
                onClick={useDownloaded}
                disabled={saving}
              >
                {saving ? 'Selecting Kokoro…' : 'Use Kokoro'}
              </button>
            </>
          ) : failed ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={close}>
                Close
              </button>
              <button ref={startRef} type="button" className="btn btn-primary" onClick={start}>
                Retry
              </button>
            </>
          ) : busy ? (
            <button ref={startRef} type="button" className="btn btn-secondary" onClick={close}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={close}>
                Not now
              </button>
              <button ref={startRef} type="button" className="btn btn-primary" onClick={start}>
                Download Kokoro
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
