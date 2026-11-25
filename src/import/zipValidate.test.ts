import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inflate, strToU8, zipSync, type ZipOptions } from 'fflate';
import { MAX_ZIP_ENTRIES, MAX_ZIP_TOTAL_BYTES } from './zipLimits';
import {
  validateZipBytes,
  validateZipInWorker,
  type ZipValidationReply,
  type ZipValidationRequest,
} from './zipValidate';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateZipBytes', () => {
  it('accepts stored and deflated entries, including streamed multi-chunk output', () => {
    const content = randomBytes(40_000);
    const data = toArrayBuffer(zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'chapter.txt': [content, { level: 6 }],
    }));

    expect(() => validateZipBytes(data)).not.toThrow();
  });

  it('accepts a ZIP comment but rejects bytes appended after the EOCD', () => {
    const original = archive({ 'a.txt': strToU8('hello') });
    const comment = strToU8('a legitimate comment');
    const commented = new Uint8Array(original.byteLength + comment.byteLength);
    commented.set(new Uint8Array(original));
    commented.set(comment, original.byteLength);
    new DataView(commented.buffer).setUint16(original.byteLength - 2, comment.byteLength, true);
    expect(() => validateZipBytes(commented.buffer)).not.toThrow();

    const junk = new Uint8Array(original.byteLength + 4);
    junk.set(new Uint8Array(original));
    junk.set([1, 2, 3, 4], original.byteLength);
    expect(() => validateZipBytes(junk.buffer)).toThrow(/invalid or unsupported ZIP/);
  });

  it.each([
    ['stored', 0],
    ['deflated', 6],
  ] as const)('rejects a CRC mismatch in a %s entry', (_label, level) => {
    const data = archive({ 'a.txt': strToU8('123456789') }, level);
    const { view, central, local } = offsets(data);
    const wrongCrc = view.getUint32(central + 16, true) ^ 0xffffffff;
    view.setUint32(central + 16, wrongCrc, true);
    view.setUint32(local + 14, wrongCrc, true);

    expect(() => validateZipBytes(data)).toThrow(/invalid or unsupported ZIP/);
  });

  it.each(['name', 'method', 'size', 'crc'] as const)('rejects a local/central %s mismatch', (field) => {
    const data = archive({ 'a.txt': strToU8('hello') });
    const { view, central, local } = offsets(data);
    if (field === 'name') {
      view.setUint8(central + 46, 'b'.charCodeAt(0));
    } else if (field === 'method') {
      view.setUint16(central + 10, 8, true);
    } else if (field === 'size') {
      view.setUint32(local + 22, view.getUint32(local + 22, true) + 1, true);
    } else {
      view.setUint32(local + 14, view.getUint32(local + 14, true) ^ 1, true);
    }

    expect(() => validateZipBytes(data)).toThrow(/invalid or unsupported ZIP/);
  });

  it.each([true, false])('accepts a data descriptor with signature=%s', (signature) => {
    const data = withDescriptor(archive({ 'a.txt': strToU8('hello') }, 6), signature);
    expect(() => validateZipBytes(data)).not.toThrow();
  });

  it('rejects a data descriptor that disagrees with the central directory', () => {
    const data = withDescriptor(archive({ 'a.txt': strToU8('hello') }), true);
    const { dataStart, central } = offsets(data);
    const descriptor = dataStart + new DataView(data).getUint32(central + 20, true) + 4;
    new DataView(data).setUint32(descriptor, 0, true);

    expect(() => validateZipBytes(data)).toThrow(/invalid or unsupported ZIP/);
  });

  it('rejects declared single-entry and aggregate bombs before inflation', () => {
    const single = archive({ 'a.txt': strToU8('small') });
    setDeclaredSize(single, MAX_ZIP_TOTAL_BYTES + 1);
    expect(() => validateZipBytes(single)).toThrow(/too large/);

    const aggregate = archive({ 'a.txt': strToU8('small'), 'b.txt': strToU8('small') });
    setDeclaredSize(aggregate, MAX_ZIP_TOTAL_BYTES, 1);
    expect(() => validateZipBytes(aggregate)).toThrow(/too large/);
  });

  it('rejects actual deflate expansion above the declared entry size', () => {
    const data = archive({ 'bomb.bin': new Uint8Array(2 * 1024 * 1024) }, 6);
    setDeclaredSize(data, 1024);

    expect(() => validateZipBytes(data)).toThrow(/invalid or unsupported ZIP/);
  });

  it('rejects stored and deflated entries whose actual size differs from the declaration', () => {
    for (const level of [0, 6] as const) {
      const data = archive({ 'a.txt': strToU8('hello') }, level);
      setDeclaredSize(data, 6);
      expect(() => validateZipBytes(data)).toThrow(/invalid or unsupported ZIP/);
    }
  });

  it('rejects too many entries without walking their headers', () => {
    const data = archive({ 'a.txt': strToU8('hello') });
    const view = new DataView(data);
    const eocd = data.byteLength - 22;
    view.setUint16(eocd + 8, MAX_ZIP_ENTRIES + 1, true);
    view.setUint16(eocd + 10, MAX_ZIP_ENTRIES + 1, true);

    expect(() => validateZipBytes(data)).toThrow(/too many files/);
  });

  it('rejects path traversal, absolute paths, NULs and malformed UTF-8 names', () => {
    for (const name of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:\\secret.txt']) {
      expect(() => validateZipBytes(archive({ [name]: strToU8('hello') }))).toThrow(/unsafe file path/);
    }

    const nulName = archive({ 'a.txt': strToU8('hello') });
    new DataView(nulName).setUint8(offsets(nulName).central + 46, 0);
    expect(() => validateZipBytes(nulName)).toThrow(/invalid or unsupported ZIP/);

    const invalidUtf8 = archive({ 'a.txt': strToU8('hello') });
    const { view, central, local } = offsets(invalidUtf8);
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 0x800, true);
    view.setUint16(local + 6, view.getUint16(local + 6, true) | 0x800, true);
    view.setUint8(central + 46, 0xff);
    view.setUint8(local + 30, 0xff);
    expect(() => validateZipBytes(invalidUtf8)).toThrow(/invalid or unsupported ZIP/);
  });

  it('rejects encrypted entries and unsupported compression methods', () => {
    const encrypted = archive({ 'a.txt': strToU8('hello') });
    const encryptedOffsets = offsets(encrypted);
    encryptedOffsets.view.setUint16(encryptedOffsets.central + 8, 1, true);
    encryptedOffsets.view.setUint16(encryptedOffsets.local + 6, 1, true);
    expect(() => validateZipBytes(encrypted)).toThrow(/invalid or unsupported ZIP/);

    const unsupported = archive({ 'a.txt': strToU8('hello') });
    const unsupportedOffsets = offsets(unsupported);
    unsupportedOffsets.view.setUint16(unsupportedOffsets.central + 10, 99, true);
    unsupportedOffsets.view.setUint16(unsupportedOffsets.local + 8, 99, true);
    expect(() => validateZipBytes(unsupported)).toThrow(/invalid or unsupported ZIP/);
  });

  it('rejects multi-disk and ZIP64 archives, including ZIP64 extra fields', () => {
    const multiDisk = archive({ 'a.txt': strToU8('hello') });
    new DataView(multiDisk).setUint16(multiDisk.byteLength - 22 + 4, 1, true);
    expect(() => validateZipBytes(multiDisk)).toThrow(/invalid or unsupported ZIP/);

    const zip64Eocd = archive({ 'a.txt': strToU8('hello') });
    new DataView(zip64Eocd).setUint16(zip64Eocd.byteLength - 22 + 10, 0xffff, true);
    expect(() => validateZipBytes(zip64Eocd)).toThrow(/invalid or unsupported ZIP/);

    const zip64Entry = archive({ 'a.txt': strToU8('hello') });
    setDeclaredSize(zip64Entry, 0xffffffff);
    expect(() => validateZipBytes(zip64Entry)).toThrow(/invalid or unsupported ZIP/);

    const zip64Extra = toArrayBuffer(zipSync({ 'a.txt': strToU8('hello') }, { extra: { 1: new Uint8Array() } }));
    expect(() => validateZipBytes(zip64Extra)).toThrow(/invalid or unsupported ZIP/);
  });

  it('rejects truncated and non-ZIP input', () => {
    const data = archive({ 'a.txt': strToU8('hello') }, 6);
    expect(() => validateZipBytes(data.slice(0, -10))).toThrow(/invalid or unsupported ZIP/);
    expect(() => validateZipBytes(new ArrayBuffer(64))).toThrow(/invalid or unsupported ZIP/);
  });

  it('honours an already-aborted signal', () => {
    const controller = new AbortController();
    controller.abort();

    expect(() => validateZipBytes(archive({ 'a.txt': strToU8('hello') }), controller.signal)).toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });

  it('can abort between streamed inflate chunks', () => {
    const controller = new AbortController();
    const data = archive({ 'large.bin': randomBytes(100_000) }, 6);
    const originalPush = Inflate.prototype.push;
    let pushes = 0;
    vi.spyOn(Inflate.prototype, 'push').mockImplementation(function (this: Inflate, chunk, final) {
      originalPush.call(this, chunk, final);
      if (++pushes === 2) controller.abort();
    });

    let thrown: unknown;
    try {
      validateZipBytes(data, controller.signal);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ name: 'AbortError' });
    expect(pushes).toBe(2);
  });
});

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

  fail(message = 'worker failed'): void {
    this.onerror?.({ message, preventDefault: vi.fn() } as unknown as ErrorEvent);
  }
}

describe('validateZipInWorker', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  it('transfers the archive to a module worker and returns the same buffer', async () => {
    const data = archive({ 'a.txt': strToU8('hello') }, 6);
    const pending = validateZipInWorker(data);
    const worker = FakeWorker.instances[0];

    expect(worker.posted[0]).toEqual({ message: { type: 'validate', bytes: data }, transfer: [data] });
    worker.reply({ type: 'valid', bytes: data });

    await expect(pending).resolves.toBe(data);
    expect(worker.terminated).toBe(true);
  });

  it('does not inflate on the main thread while the worker is pending', async () => {
    const push = vi.spyOn(Inflate.prototype, 'push');
    const data = archive({ 'a.txt': randomBytes(40_000) }, 6);
    const pending = validateZipInWorker(data);

    expect(push).not.toHaveBeenCalled();
    FakeWorker.instances[0].reply({ type: 'valid', bytes: data });
    await pending;
    expect(push).not.toHaveBeenCalled();
  });

  it('returns transferred bytes even when the worker reports invalid data', async () => {
    const data = archive({ 'a.txt': strToU8('hello') });
    const pending = validateZipInWorker(data);
    const worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toThrow(/invalid or unsupported ZIP/);

    worker.reply({ type: 'invalid', bytes: data, message: 'This book has an invalid or unsupported ZIP archive.' });
    await rejected;
    expect(data.byteLength).toBeGreaterThan(0);
    expect(worker.terminated).toBe(true);
  });

  it('terminates the worker and rejects with AbortError when cancelled', async () => {
    const controller = new AbortController();
    const pending = validateZipInWorker(archive({ 'a.txt': strToU8('hello') }), controller.signal);
    const worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejected;
    expect(worker.terminated).toBe(true);
  });

  it('does not start a worker for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(validateZipInWorker(new ArrayBuffer(0), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('rejects and terminates when the worker fails', async () => {
    const pending = validateZipInWorker(archive({ 'a.txt': strToU8('hello') }));
    const worker = FakeWorker.instances[0];
    const rejected = expect(pending).rejects.toThrow(/worker failed/);

    worker.fail();
    await rejected;
    expect(worker.terminated).toBe(true);
  });
});

function archive(files: Record<string, Uint8Array>, level: ZipOptions['level'] = 0): ArrayBuffer {
  return toArrayBuffer(zipSync(files, { level }));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let at = 0; at < length; at += 65_536) {
    crypto.getRandomValues(bytes.subarray(at, Math.min(at + 65_536, length)));
  }
  return bytes;
}

function offsets(data: ArrayBuffer, index = 0): {
  view: DataView;
  eocd: number;
  central: number;
  local: number;
  dataStart: number;
} {
  const view = new DataView(data);
  const eocd = data.byteLength - 22;
  let central = view.getUint32(eocd + 16, true);
  for (let current = 0; current < index; current++) {
    central += 46 + view.getUint16(central + 28, true) + view.getUint16(central + 30, true) + view.getUint16(central + 32, true);
  }
  const local = view.getUint32(central + 42, true);
  const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  return { view, eocd, central, local, dataStart };
}

function setDeclaredSize(data: ArrayBuffer, size: number, index = 0): void {
  const { view, central, local } = offsets(data, index);
  view.setUint32(central + 24, size, true);
  view.setUint32(local + 22, size, true);
}

function withDescriptor(data: ArrayBuffer, signature: boolean): ArrayBuffer {
  const { view, central, local, dataStart } = offsets(data);
  const compressed = view.getUint32(central + 20, true);
  const uncompressed = view.getUint32(central + 24, true);
  const crc = view.getUint32(central + 16, true);
  const dataEnd = dataStart + compressed;
  const descriptorLength = signature ? 16 : 12;
  const old = new Uint8Array(data);
  const result = new Uint8Array(data.byteLength + descriptorLength);
  result.set(old.subarray(0, dataEnd));
  result.set(old.subarray(dataEnd), dataEnd + descriptorLength);

  const output = new DataView(result.buffer);
  let descriptor = dataEnd;
  if (signature) {
    output.setUint32(descriptor, 0x08074b50, true);
    descriptor += 4;
  }
  output.setUint32(descriptor, crc, true);
  output.setUint32(descriptor + 4, compressed, true);
  output.setUint32(descriptor + 8, uncompressed, true);
  output.setUint16(local + 6, output.getUint16(local + 6, true) | 0x08, true);
  output.setUint16(central + descriptorLength + 8, output.getUint16(central + descriptorLength + 8, true) | 0x08, true);
  output.setUint32(local + 14, 0, true);
  output.setUint32(local + 18, 0, true);
  output.setUint32(local + 22, 0, true);
  output.setUint32(data.byteLength - 22 + descriptorLength + 16, central + descriptorLength, true);
  return result.buffer;
}
