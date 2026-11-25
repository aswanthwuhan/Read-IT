import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inflate, strToU8, zipSync } from 'fflate';
import type { ZipValidationReply, ZipValidationRequest } from './zipValidate';

const mammoth = vi.hoisted(() => ({
  convertToHtml: vi.fn(),
  images: { imgElement: vi.fn(() => vi.fn()) },
}));

vi.mock('mammoth', () => ({ default: mammoth }));

import { parseDocx } from './docx';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: Array<{ message: ZipValidationRequest; transfer: Transferable[] }> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
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

beforeEach(() => {
  FakeWorker.instances = [];
  mammoth.convertToHtml.mockReset();
  mammoth.convertToHtml.mockResolvedValue({ value: '<p>A readable sentence.</p>', messages: [] });
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseDocx ZIP validation', () => {
  it('awaits the module worker, never inflates on the main thread, and uses the returned bytes', async () => {
    const push = vi.spyOn(Inflate.prototype, 'push');
    const data = toArrayBuffer(zipSync({ 'word/document.xml': strToU8('<document/>') }));
    const returned = data.slice(0);
    const pending = parseDocx(data, 'Fallback title');
    const worker = FakeWorker.instances[0];

    expect(worker.posted[0]).toEqual({ message: { type: 'validate', bytes: data }, transfer: [data] });
    expect(push).not.toHaveBeenCalled();
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();

    worker.reply({ type: 'valid', bytes: returned });
    const doc = await pending;

    expect(push).not.toHaveBeenCalled();
    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
    const input = mammoth.convertToHtml.mock.calls[0]?.[0] as { arrayBuffer: ArrayBuffer };
    const options = mammoth.convertToHtml.mock.calls[0]?.[1] as { convertImage?: unknown };
    expect(input.arrayBuffer).toBe(returned);
    expect(options.convertImage).toBeTypeOf('function');
    expect(doc.format).toBe('docx');
    expect(doc.title).toBe('Fallback title');
    expect(doc.chapters.flatMap((chapter) => chapter.blocks.flatMap((block) => block.sentences.map((sentence) => sentence.text)))).toContain(
      'A readable sentence.',
    );
    expect(worker.terminated).toBe(true);
  });

  it('rejects malformed/non-ZIP input from the worker without handing it to mammoth', async () => {
    const data = new TextEncoder().encode('not a zip').buffer;
    const pending = parseDocx(data, 'Fallback title');
    const worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toThrow(/invalid or unsupported ZIP/);

    worker.reply({ type: 'invalid', bytes: data, message: 'This book has an invalid or unsupported ZIP archive.' });
    await rejected;
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
  });

  it('terminates validation when its AbortSignal is cancelled', async () => {
    const controller = new AbortController();
    const data = toArrayBuffer(zipSync({ 'word/document.xml': strToU8('<document/>') }));
    const pending = parseDocx(data, 'Fallback title', { signal: controller.signal });
    const worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
    expect(mammoth.convertToHtml).not.toHaveBeenCalled();
  });
});

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
