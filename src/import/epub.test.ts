import { afterEach, describe, expect, it, vi } from 'vitest';
import { Inflate, strToU8, zipSync } from 'fflate';
import { parseEpub } from './epub';
import { EPUB_IMPORT_MAX_BYTES } from './limits';
import { MAX_ZIP_TOTAL_BYTES } from './zipLimits';
import type { ZipValidationReply, ZipValidationRequest } from './zipValidate';

class PendingWorker {
  static instances: PendingWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: Array<{ message: ZipValidationRequest; transfer: Transferable[] }> = [];
  terminated = false;

  constructor() {
    PendingWorker.instances.push(this);
  }

  postMessage(message: ZipValidationRequest, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(reply: ZipValidationReply): void {
    this.onmessage?.({ data: reply } as MessageEvent);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  PendingWorker.instances = [];
});

describe('parseEpub archive hardening', () => {
  it('parses a synthetic EPUB without Worker and never loads external resources', async () => {
    vi.stubGlobal('Worker', undefined);
    const fetchResource = vi.fn();
    vi.stubGlobal('fetch', fetchResource);
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          throw new Error('network access during EPUB import');
        }
      },
    );

    const doc = await parseEpub(epubArchive(), 'fallback');

    expect(doc.format).toBe('epub');
    expect(doc.title).toBe('Café & Tea');
    expect(doc.author).toBe('A. Writer');
    expect(doc.chapters.map((chapter) => chapter.title)).toEqual(['First chapter']);
    expect(doc.chapters[0]?.blocks.flatMap((block) => block.sentences.map((sentence) => sentence.text))).toContain(
      'A readable sentence with café and tea.',
    );
    expect(fetchResource).not.toHaveBeenCalled();
  });

  it('validates in the worker, transfers once, and opens the returned buffer', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const push = vi.spyOn(Inflate.prototype, 'push');
    const data = epubArchive();
    const returned = data.slice(0);
    const pending = parseEpub(data, 'fallback');
    const worker = PendingWorker.instances[0];

    expect(worker.posted[0]).toEqual({ message: { type: 'validate', bytes: data }, transfer: [data] });
    expect(push).not.toHaveBeenCalled();

    worker.reply({ type: 'valid', bytes: returned });
    // A real transfer detaches the original. Corrupting it here proves epubjs
    // receives the worker's returned bytes rather than reusing the input.
    new Uint8Array(data).fill(0);
    const doc = await pending;

    expect(doc.title).toBe('Café & Tea');
    expect(push).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });

  it('rejects an over-cap input before starting validation', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const oversized = { byteLength: EPUB_IMPORT_MAX_BYTES + 1 } as ArrayBuffer;

    await expect(parseEpub(oversized, 'oversized')).rejects.toThrow(/over 100 MB/);
    expect(PendingWorker.instances).toHaveLength(0);
  });

  it('rejects an unsafe archive before any DOM is parsed', async () => {
    vi.stubGlobal('Worker', undefined);
    const parseFromString = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const files = epubFiles();
    files['../escape.xhtml'] = strToU8('<html><body>escape</body></html>');

    await expect(parseEpub(toArrayBuffer(zipSync(files)), 'unsafe')).rejects.toThrow(/unsafe file path/);
    expect(parseFromString).not.toHaveBeenCalled();
  });

  it('rejects a declared expansion bomb before inflation or DOM parsing', async () => {
    vi.stubGlobal('Worker', undefined);
    const push = vi.spyOn(Inflate.prototype, 'push');
    const parseFromString = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const data = epubArchive();
    const { view, central, local } = offsets(data);
    view.setUint32(central + 24, MAX_ZIP_TOTAL_BYTES + 1, true);
    view.setUint32(local + 22, MAX_ZIP_TOTAL_BYTES + 1, true);

    await expect(parseEpub(data, 'bomb')).rejects.toThrow(/too large/);
    expect(push).not.toHaveBeenCalled();
    expect(parseFromString).not.toHaveBeenCalled();
  });

  it('does not start validation for an already-aborted signal', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const controller = new AbortController();
    controller.abort();

    await expect(parseEpub(epubArchive(), 'cancelled', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(PendingWorker.instances).toHaveLength(0);
  });

  it('terminates the worker and rejects promptly when cancelled during validation', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const controller = new AbortController();
    const pending = parseEpub(epubArchive(), 'cancelled', controller.signal);
    const worker = PendingWorker.instances[0];
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
  });

  it('surfaces a worker validation error without opening the archive', async () => {
    vi.stubGlobal('Worker', PendingWorker);
    const parseFromString = vi.spyOn(DOMParser.prototype, 'parseFromString');
    const data = new TextEncoder().encode('not a zip').buffer;
    const pending = parseEpub(data, 'invalid');
    const rejected = expect(pending).rejects.toThrow(/invalid or unsupported ZIP/);

    PendingWorker.instances[0].reply({
      type: 'invalid',
      bytes: data,
      message: 'This book has an invalid or unsupported ZIP archive.',
    });
    await rejected;
    expect(parseFromString).not.toHaveBeenCalled();
  });
});

function epubArchive(): ArrayBuffer {
  return toArrayBuffer(zipSync(epubFiles()));
}

function epubFiles(): Record<string, Uint8Array | [Uint8Array, { level: 0 }]> {
  return {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Café &amp; Tea</dc:title><dc:creator>A. Writer</dc:creator><dc:identifier id="book-id">synthetic-book</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="local-image" href="images/local.png" media-type="image/png"/>
    <item id="local-font" href="fonts/local.woff2" media-type="font/woff2"/>
    <item id="remote-image" href="https://example.test/tracker.png" media-type="image/png"/>
    <item id="remote-font" href="https://example.test/font.woff2" media-type="font/woff2"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">First chapter</a></li></ol></nav></body>
</html>`),
    'OEBPS/chapter.xhtml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter</title><style>@font-face { font-family: Local; src: url(fonts/local.woff2); }</style></head>
<body><h1>First chapter</h1><p>A readable sentence with café and tea.</p>
<img src="images/local.png" alt="local"/><img src="https://example.test/tracker.png" alt="remote"/>
</body></html>`),
    'OEBPS/images/local.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    'OEBPS/fonts/local.woff2': strToU8('synthetic font bytes'),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function offsets(data: ArrayBuffer): { view: DataView; central: number; local: number } {
  const view = new DataView(data);
  const central = view.getUint32(data.byteLength - 22 + 16, true);
  const local = view.getUint32(central + 42, true);
  return { view, central, local };
}
