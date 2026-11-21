/**
 * The toolbar that appears over a text selection: highlight it, annotate it,
 * bookmark the sentence, or keep reading. It wears the same sheet surface and
 * corner radius as every other panel in the app.
 */
import { useEffect, useRef, useState } from 'react';
import { Glyph, icons } from './Icon';

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

interface Props {
  text: string;
  count: number;
  onPlay(): void;
  onHighlight(color: HighlightColor): void;
  onNote(note: string): void;
  onBookmark(): void;
  onExtend(): void;
  onClose(): void;
}

const COLORS: { color: HighlightColor; label: string }[] = [
  { color: 'yellow', label: 'Yellow highlight' },
  { color: 'green', label: 'Green highlight' },
  { color: 'blue', label: 'Blue highlight' },
  { color: 'pink', label: 'Pink highlight' },
];

export default function SelectionBar({
  text,
  count,
  onPlay,
  onHighlight,
  onNote,
  onBookmark,
  onExtend,
  onClose,
}: Props) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Keyboard and screen-reader users land in the toolbar, not back at the top
  // of the document.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus();
    // Return focus where the selection started when the toolbar closes.
    return () => {
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      ref={box}
      className="rd-select"
      role="dialog"
      aria-modal="true"
      aria-label={`Actions for ${count} selected sentence${count === 1 ? '' : 's'}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'Tab') return;
        // aria-modal content must contain Tab, including when the container
        // itself (tabIndex=-1) started with focus.
        const focusable = [...(box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [])];
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <div className="rd-select-head">
        <p className="rd-select-text">{text.length > 140 ? `${text.slice(0, 140)}…` : text}</p>
        <button
          type="button"
          className="btn btn-ghost btn-icon rd-select-close"
          aria-label="Close actions"
          onClick={onClose}
        >
          <Glyph>{icons.close}</Glyph>
        </button>
      </div>

      {noteOpen ? (
        <form
          className="rd-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            onNote(note.trim());
            setNote('');
            setNoteOpen(false);
          }}
        >
          <label htmlFor="rd-note">Note</label>
          <textarea
            id="rd-note"
            className="input rd-note-input"
            value={note}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              // Escape cancels just the note field, not the whole selection.
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              setNote('');
              setNoteOpen(false);
              box.current?.focus();
            }}
            autoFocus
          />
          <div className="rd-note-actions">
            <button type="submit" className="btn btn-primary" disabled={!note.trim()}>
              Save note
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setNoteOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="rd-colors" role="group" aria-label="Highlight colour">
            {COLORS.map((entry) => (
              <button
                key={entry.color}
                type="button"
                className={`rd-swatch rd-swatch-${entry.color}`}
                aria-label={entry.label}
                title={entry.label}
                onClick={() => onHighlight(entry.color)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="rd-select-actions">
            <button
              type="button"
              className="btn btn-primary rd-action"
              aria-label="Play selection"
              onClick={onPlay}
            >
              <Glyph>{icons.play}</Glyph><span>Play</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost rd-action"
              aria-label="Extend selection by one sentence"
              onClick={onExtend}
            >
              <Glyph>{icons.plus}</Glyph><span>Sentence</span>
            </button>
            <button type="button" className="btn btn-ghost rd-action" onClick={() => setNoteOpen(true)}>
              <Glyph>{icons.note}</Glyph><span>Note</span>
            </button>
            <button type="button" className="btn btn-ghost rd-action" onClick={onBookmark}>
              <Glyph>{icons.bookmark}</Glyph><span>Bookmark</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
