import { Inflate } from 'fflate';
import { assertArchiveSize, assertSafeName, MAX_ZIP_ENTRIES } from './zipLimits';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_SENTINEL = 0xffffffff;
const ZIP64_EXTRA_FIELD = 0x0001;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const INFLATE_CHUNK_BYTES = 4096;
const CRC_CHUNK_BYTES = 64 * 1024;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const LEGACY_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const CRC_TABLE = createCrcTable();

export interface ZipValidationRequest {
  type: 'validate';
  bytes: ArrayBuffer;
}

export type ZipValidationReply =
  | { type: 'valid'; bytes: ArrayBuffer }
  | { type: 'invalid'; bytes: ArrayBuffer; message: string };

interface LocalRegion {
  start: number;
  end: number;
}

/**
 * Validate a ZIP32 archive without retaining any inflated entry. The function is
 * deliberately pure so the same checks run in unit tests and in the worker.
 */
export function validateZipBytes(data: ArrayBuffer, signal?: AbortSignal): void {
  throwIfAborted(signal);
  const bytes = new Uint8Array(data);
  if (bytes.byteLength < 22) throw invalidZip();
  const view = new DataView(data);
  const eocd = findEocd(bytes, view);
  if (eocd < 0) throw invalidZip();

  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directory = view.getUint32(eocd + 16, true);

  if (
    entryCount === 0xffff ||
    entriesOnDisk === 0xffff ||
    directory === ZIP64_SENTINEL ||
    directorySize === ZIP64_SENTINEL
  ) {
    throw invalidZip();
  }
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount > MAX_ZIP_ENTRIES
  ) {
    if (entryCount > MAX_ZIP_ENTRIES) {
      throw new Error("That book's archive has too many files to open safely.");
    }
    throw invalidZip();
  }
  if (directory + directorySize !== eocd) {
    throw invalidZip();
  }

  const regions: LocalRegion[] = [];
  let offset = directory;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index++) {
    throwIfAborted(signal);
    if (offset + CENTRAL_HEADER_SIZE > eocd || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw invalidZip();
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const centralLength = CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;

    if (
      offset + centralLength > eocd ||
      diskStart !== 0 ||
      localOffset === ZIP64_SENTINEL ||
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      nameLength === 0 ||
      (flags & 0x41) !== 0 ||
      (method !== 0 && method !== 8)
    ) {
      throw invalidZip();
    }

    const nameBytes = bytes.subarray(offset + CENTRAL_HEADER_SIZE, offset + CENTRAL_HEADER_SIZE + nameLength);
    if (nameBytes.includes(0)) throw invalidZip();
    let name: string;
    try {
      name = (flags & 0x800 ? UTF8_DECODER : LEGACY_DECODER).decode(nameBytes);
    } catch {
      throw invalidZip();
    }
    assertSafeName(name);
    assertArchiveSize(totalUncompressed + uncompressedSize);
    assertNoZip64Extra(view, offset + CENTRAL_HEADER_SIZE + nameLength, extraLength);

    if (localOffset + LOCAL_HEADER_SIZE > directory || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw invalidZip();
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc = view.getUint32(localOffset + 14, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localLength = LOCAL_HEADER_SIZE + localNameLength + localExtraLength;

    if (
      localOffset + localLength > directory ||
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      localCompressedSize === ZIP64_SENTINEL ||
      localUncompressedSize === ZIP64_SENTINEL ||
      !sameBytes(bytes, localOffset + LOCAL_HEADER_SIZE, nameBytes)
    ) {
      throw invalidZip();
    }
    assertNoZip64Extra(view, localOffset + LOCAL_HEADER_SIZE + localNameLength, localExtraLength);

    const hasDescriptor = (flags & 0x08) !== 0;
    if (
      (!hasDescriptor &&
        (localCrc !== expectedCrc ||
          localCompressedSize !== compressedSize ||
          localUncompressedSize !== uncompressedSize)) ||
      (hasDescriptor &&
        ((localCrc !== 0 && localCrc !== expectedCrc) ||
          (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
          (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)))
    ) {
      throw invalidZip();
    }

    const dataStart = localOffset + localLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > directory || (method === 0 && compressedSize !== uncompressedSize)) {
      throw invalidZip();
    }

    const produced = validateEntryData(
      bytes,
      dataStart,
      compressedSize,
      uncompressedSize,
      expectedCrc,
      method,
      totalUncompressed,
      signal,
    );
    totalUncompressed += produced;

    const regionEnd = hasDescriptor
      ? validateDescriptor(view, dataEnd, directory, expectedCrc, compressedSize, uncompressedSize)
      : dataEnd;
    regions.push({ start: localOffset, end: regionEnd });
    offset += centralLength;
  }

  if (offset !== eocd) throw invalidZip();
  regions.sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  for (const region of regions) {
    if (region.start < previousEnd) throw invalidZip();
    previousEnd = region.end;
  }
}

/**
 * Move validation off the main thread. The archive buffer is transferred both
 * ways, so the worker and mammoth can use the same bytes without a second copy.
 * Hosts without Worker support (Node tests and SSR) retain a synchronous fallback.
 */
export async function validateZipInWorker(data: ArrayBuffer, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  if (typeof Worker !== 'function') {
    validateZipBytes(data, signal);
    return data;
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL('./zipValidate.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    throw new Error('The ZIP validation worker could not start.');
  }

  const expectedLength = data.byteLength;
  return new Promise<ArrayBuffer>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const succeed = (validated: ArrayBuffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(validated);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new DOMException('The import was cancelled.', 'AbortError'));

    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ZipValidationReply>) => {
      const reply = event.data;
      if (settled) return;
      if (signal?.aborted) {
        onAbort();
      } else if (reply?.type === 'valid' && isArrayBuffer(reply.bytes) && reply.bytes.byteLength === expectedLength) {
        succeed(reply.bytes);
      } else if (reply?.type === 'invalid' && isArrayBuffer(reply.bytes)) {
        fail(new Error(reply.message || 'This book has an invalid or unsupported ZIP archive.'));
      } else {
        fail(new Error('The ZIP validation worker sent an unreadable reply.'));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'The ZIP validation worker stopped.'));
    };
    worker.onmessageerror = () => fail(new Error('The ZIP validation worker sent an unreadable reply.'));

    try {
      worker.postMessage({ type: 'validate', bytes: data } satisfies ZipValidationRequest, [data]);
    } catch {
      fail(new Error('The ZIP validation worker could not read the archive.'));
    }
  });
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const first = Math.max(0, bytes.byteLength - 22 - 0xffff);
  for (let at = bytes.byteLength - 22; at >= first; at--) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    // A ZIP comment is legal; arbitrary bytes after the EOCD are not.
    if (at + 22 + view.getUint16(at + 20, true) === bytes.byteLength) return at;
  }
  return -1;
}

function validateEntryData(
  bytes: Uint8Array,
  start: number,
  compressedSize: number,
  declaredSize: number,
  expectedCrc: number,
  method: number,
  previousTotal: number,
  signal?: AbortSignal,
): number {
  let produced = 0;
  let checksum = 0xffffffff;
  let failure: Error | undefined;
  const consume = (chunk: Uint8Array) => {
    if (failure) return;
    throwIfAborted(signal);
    produced += chunk.length;
    if (produced > declaredSize) {
      failure = invalidZip();
      return;
    }
    try {
      assertArchiveSize(previousTotal + produced);
    } catch (error) {
      failure = error instanceof Error ? error : invalidZip();
      return;
    }
    checksum = updateCrc(checksum, chunk);
  };

  if (method === 0) {
    for (let at = start; at < start + compressedSize; at += CRC_CHUNK_BYTES) {
      consume(bytes.subarray(at, Math.min(at + CRC_CHUNK_BYTES, start + compressedSize)));
      if (failure) throw failure;
    }
  } else {
    if (compressedSize === 0) throw invalidZip();
    const inflate = new Inflate(consume);
    const finish = start + compressedSize;
    try {
      for (let at = start; at < finish; at += INFLATE_CHUNK_BYTES) {
        throwIfAborted(signal);
        const next = Math.min(at + INFLATE_CHUNK_BYTES, finish);
        inflate.push(bytes.subarray(at, next), next === finish);
        if (failure) throw failure;
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
      if (error === failure) throw error;
      throw invalidZip();
    }
  }

  if (failure) throw failure;
  if (produced !== declaredSize || ((checksum ^ 0xffffffff) >>> 0) !== expectedCrc) throw invalidZip();
  return produced;
}

function validateDescriptor(
  view: DataView,
  at: number,
  directory: number,
  expectedCrc: number,
  compressedSize: number,
  uncompressedSize: number,
): number {
  let cursor = at;
  if (cursor + 4 <= directory && view.getUint32(cursor, true) === DESCRIPTOR_SIGNATURE) cursor += 4;
  if (cursor + 12 > directory) throw invalidZip();
  const crc = view.getUint32(cursor, true);
  const compressed = view.getUint32(cursor + 4, true);
  const uncompressed = view.getUint32(cursor + 8, true);
  if (
    crc !== expectedCrc ||
    compressed === ZIP64_SENTINEL ||
    uncompressed === ZIP64_SENTINEL ||
    compressed !== compressedSize ||
    uncompressed !== uncompressedSize
  ) {
    throw invalidZip();
  }
  return cursor + 12;
}

function assertNoZip64Extra(view: DataView, start: number, length: number): void {
  let offset = start;
  const end = start + length;
  while (offset < end) {
    if (offset + 4 > end) throw invalidZip();
    const tag = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + size > end) throw invalidZip();
    if (tag === ZIP64_EXTRA_FIELD) throw invalidZip();
    offset += size;
  }
}

function sameBytes(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset + expected.byteLength > bytes.byteLength) return false;
  for (let index = 0; index < expected.byteLength; index++) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The import was cancelled.', 'AbortError');
}

function invalidZip(): Error {
  return new Error('This book has an invalid or unsupported ZIP archive.');
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  return table;
}

function updateCrc(crc: number, bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}
