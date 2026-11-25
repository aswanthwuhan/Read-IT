import { useState } from 'react';
import {
  LAST_EXPORT_SETTING,
  backupFileName,
  exportBackup,
  importBackup,
  lastBackupLabel,
  type ImportMode,
  type ImportReport,
} from './backup';
import { setSetting, useSetting } from '../core/settings';
import { saveFile } from '../core/saveFile';
import './backup.css';

const TABLE_LABEL: Record<string, readonly [string, string]> = {
  books: ['book', 'books'],
  bookContent: ['book document', 'book documents'],
  highlights: ['highlight', 'highlights'],
  bookmarks: ['bookmark', 'bookmarks'],
  lexicon: ['pronunciation', 'pronunciations'],
  settings: ['setting', 'settings'],
};

function label(table: string, n: number): string {
  const pair = TABLE_LABEL[table];
  if (!pair) return table;
  return n === 1 ? pair[0] : pair[1];
}

/**
 * Backup panel for the Settings page: one flat block out, one flat block back
 * in, with a hairline between them. The page supplies the surface, so neither
 * block draws a card of its own.
 */
export default function BackupPanel() {
  const [busy, setBusy] = useState<'books' | 'data' | 'import' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const lastExport = useSetting<number>(LAST_EXPORT_SETTING, 0);

  async function runExport(includeBooks: boolean) {
    setBusy(includeBooks ? 'books' : 'data');
    setStatus(null);
    try {
      const blob = await exportBackup({ includeBooks });
      const name = backupFileName();
      // The banner waits for the save: an Android WebView used to drop the
      // download while the panel still claimed the file was exported.
      const { location } = await saveFile(blob, name);
      // The file is saved by now; a failed timestamp write must not turn a
      // successful export into an error banner.
      await setSetting(LAST_EXPORT_SETTING, Date.now()).catch(() => undefined);
      setStatus({ ok: true, text: `Saved ${name} (${megabytes(blob.size)}) to ${location}.` });
    } catch (err) {
      setStatus({ ok: false, text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    if (!file) return;
    if (
      mode === 'replace' &&
      !window.confirm(
        'Replace all books, notes, highlights, bookmarks, pronunciations and cached audio on this device with the backup? ' +
          'Settings in the backup are overwritten; private/device settings are kept. This cannot be undone.',
      )
    ) {
      return;
    }
    setBusy('import');
    setStatus(null);
    try {
      setStatus({ ok: true, text: describe(await importBackup(file, mode)) });
    } catch (err) {
      setStatus({ ok: false, text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="backup-panel">
      <section className="backup-block" aria-labelledby="backup-export-title">
        <h3 className="card-title" id="backup-export-title">
          Export
        </h3>
        <p className="backup-line">Everything stays on this device until you export it.</p>
        <div className="backup-actions">
          <button type="button" className="btn btn-primary" onClick={() => void runExport(true)} disabled={busy !== null}>
            {busy === 'books' ? 'Exporting…' : 'Export (with books)'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void runExport(false)} disabled={busy !== null}>
            {busy === 'data' ? 'Exporting…' : 'Export (notes only)'}
          </button>
        </div>
        <p className="muted backup-last tnum">{lastBackupLabel(lastExport)}</p>
      </section>

      <section className="backup-block" aria-labelledby="backup-import-title">
        <h3 className="card-title" id="backup-import-title">
          Import
        </h3>
        <p className="backup-line">Restores a backup made with Read IT, on this device or another one.</p>

        <div className="field">
          <label className="field-label" htmlFor="backup-file">
            Backup file
          </label>
          <input
            id="backup-file"
            className="backup-file"
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy !== null}
          />
        </div>

        <div className="backup-mode" role="radiogroup" aria-labelledby="backup-mode-label">
          <p id="backup-mode-label" className="field-label">
            Import mode
          </p>
          <label className="backup-radio">
            <input
              id="backup-merge"
              type="radio"
              name="backup-mode"
              checked={mode === 'merge'}
              onChange={() => setMode('merge')}
            />
            <span>
              <span className="backup-radio-label">Merge</span> — add new records; matching IDs already
              here are kept
            </span>
          </label>
          <label className="backup-radio">
            <input
              id="backup-replace"
              type="radio"
              name="backup-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <span>
              <span className="backup-radio-label">Replace</span> — delete local books, notes, highlights,
              bookmarks, pronunciations and cached audio first; overwrite settings in the backup
            </span>
          </label>
        </div>

        {mode === 'replace' ? (
          <div className="banner banner-warning" role="alert">
            <p>
              Importing will delete the books, notes, highlights, bookmarks, pronunciations and cached
              audio already on this device. Settings in the backup overwrite matching settings here;
              private/device settings are kept. This cannot be undone.
            </p>
          </div>
        ) : null}

        <div className="backup-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void runImport()}
            disabled={!file || busy !== null}
          >
            {busy === 'import' ? 'Importing…' : 'Import backup'}
          </button>
        </div>
      </section>

      {status ? (
        <div className={status.ok ? 'banner banner-success' : 'banner banner-error'} role={status.ok ? 'status' : 'alert'}>
          <p>{status.text}</p>
        </div>
      ) : null}

      <details className="disc-sub">
        <summary>How this works</summary>
        <div className="disc-sub-body">
          <div className="backup-explain">
            <p>
              The audio cache is left out of a backup — it is rebuilt when you listen again. Merge keeps
              cached audio on this device; Replace clears it as part of a successful restore. Private
              per-device settings are never written into a backup.
            </p>
            <p>
              The .zip holds your books, highlights, notes and settings. On a phone it is saved in Documents/Read IT; in a browser
              it goes to your Downloads folder.
            </p>
            <p>
              Merge adds records whose IDs are not already here. Matching local books and their
              documents, notes, highlights, bookmarks, settings and pronunciations are kept; IDs repeated
              in the backup are skipped. Replace deletes local books, notes, highlights, bookmarks,
              pronunciations and cached audio first and overwrites settings included in the backup;
              private/device settings stay as they are.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

function describe(report: ImportReport): string {
  const parts = Object.entries(report.counts).map(([table, n]) => `${n} ${label(table, n)}`);
  const head = parts.length ? `Imported ${parts.join(', ')}.` : 'The backup had no records.';
  const skipped = Object.values(report.skipped).reduce((total, n) => total + n, 0);
  const collisions = Object.values(report.collisions).reduce((total, n) => total + n, 0);
  const details: string[] = [];
  if (collisions > 0) {
    details.push(
      `Skipped ${collisions} record${collisions === 1 ? '' : 's'} because of ID collisions with local data, ` +
        'an existing book or repeated IDs in the backup.',
    );
  }
  const orphans = skipped - collisions;
  if (orphans > 0) {
    details.push(
      `Skipped ${orphans} book document${orphans === 1 ? '' : 's'} without a matching book in the import.`,
    );
  }
  if (report.audioCleared) details.push('Cached audio was cleared.');
  const missing = report.missingFile.length
    ? ` ${report.missingFile.length} book file${report.missingFile.length === 1 ? ' was' : 's were'} not in the zip — re-import those books to read them.`
    : '';
  return [head, ...details, missing.trim()].filter(Boolean).join(' ');
}

function megabytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
