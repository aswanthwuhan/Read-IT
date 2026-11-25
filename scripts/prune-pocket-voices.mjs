// Local-only Pocket TTS voices.bin pruning and verification.
//
// PTVB1 is documented in node_modules/pocket-tts-js/src/binary.js. This tool is
// deliberately stricter than that runtime parser: every field is bounds
// checked, UTF-8 is fatal, duplicate names are rejected, tensor payload sizes
// must match their dtype and shape, and the file must end at the final record.
//
// No dependencies, network access, model downloads, or runtime synthesis.

import { createHash, randomUUID } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_VERSION = '1.0.0';
export const MANIFEST_FORMAT = 'readit-pocket-voices-prune';
export const MANIFEST_VERSION = 1;
export const SAFE_VOICE_NAMES = Object.freeze([
  'alba',
  'azelma',
  'eponine',
  'fantine',
  'javert',
  'marius',
]);
export const FORBIDDEN_VOICE_NAMES = Object.freeze(['cosette', 'jean']);

const SAFE_VOICE_SET = new Set(SAFE_VOICE_NAMES);
const FORBIDDEN_VOICE_SET = new Set(FORBIDDEN_VOICE_NAMES);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAGIC = Buffer.from('PTVB1', 'ascii');
const HEADER_BYTES = MAGIC.length + 4;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;
const DTYPES = new Map([
  [0, { name: 'float32', byteWidth: 4 }],
  [1, { name: 'int64', byteWidth: 8 }],
  [2, { name: 'bool', byteWidth: 1 }],
]);

const USAGE = `Usage:
  node scripts/prune-pocket-voices.mjs inspect \\
    --source <voices.bin> --source-sha256 <64 hex digits> \\
    --bundle-json <bundle.json> --bundle-sha256 <64 hex digits>

  node scripts/prune-pocket-voices.mjs prune \\
    --source <voices.bin> --source-sha256 <64 hex digits> \\
    --bundle-json <bundle.json> --bundle-sha256 <64 hex digits> \\
    --output <pruned-voices.bin> --manifest <prune-manifest.json>

  node scripts/prune-pocket-voices.mjs verify \\
    --source <voices.bin> --source-sha256 <64 hex digits> \\
    --bundle-json <bundle.json> --bundle-sha256 <64 hex digits> \\
    --input <pruned-voices.bin> --manifest <prune-manifest.json> \\
    [--input-sha256 <64 hex digits>]

All hashes are explicit inputs. Nothing is downloaded. See docs/POCKET-VOICES.md.`;

export class PocketVoicesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PocketVoicesError';
  }
}

function fail(message) {
  throw new PocketVoicesError(message);
}

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail(`${label} must be a Buffer, Uint8Array, or ArrayBuffer`);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) {
    fail(`${label} must be exactly 64 hexadecimal characters`);
  }
  return value.toLowerCase();
}

function assertSha256(bytes, expected, label) {
  const normalized = normalizeSha256(expected, label);
  const actual = sha256Hex(bytes);
  if (actual !== normalized) {
    fail(`${label} mismatch: expected ${normalized}, got ${actual}`);
  }
  return actual;
}

function checkedAdd(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail(`${label} exceeds the safe integer range`);
  return result;
}

function assertSafeIdentifier(value, label) {
  if (UNSAFE_KEYS.has(value)) fail(`${label} contains forbidden key ${JSON.stringify(value)}`);
}

class Reader {
  constructor(bytes, label) {
    this.bytes = bytes;
    this.length = bytes.length;
    this.offset = 0;
    this.label = label;
    this.decoder = new TextDecoder('utf-8', { fatal: true });
  }

  remaining() {
    return this.length - this.offset;
  }

  need(count, description) {
    if (!Number.isSafeInteger(count) || count < 0) {
      fail(`${this.label}: invalid ${description} length ${count}`);
    }
    const end = checkedAdd(this.offset, count, `${this.label} offset`);
    if (end > this.length) {
      fail(
        `${this.label}: truncated while reading ${description} at byte ${this.offset} ` +
          `(need ${count}, have ${this.remaining()})`,
      );
    }
    return end;
  }

  uint8(description) {
    const end = this.need(1, description);
    const value = this.bytes[this.offset];
    this.offset = end;
    return value;
  }

  uint16(description) {
    const end = this.need(2, description);
    const value = this.bytes.readUInt16LE(this.offset);
    this.offset = end;
    return value;
  }

  uint32(description) {
    const end = this.need(4, description);
    const value = this.bytes.readUInt32LE(this.offset);
    this.offset = end;
    return value;
  }

  text(byteLength, description) {
    const end = this.need(byteLength, description);
    let value;
    try {
      value = this.decoder.decode(this.bytes.subarray(this.offset, end));
    } catch {
      fail(`${this.label}: ${description} at byte ${this.offset} is not valid UTF-8`);
    }
    this.offset = end;
    if (value.length === 0) fail(`${this.label}: ${description} must not be empty`);
    return value;
  }

  payload(byteLength, description) {
    const end = this.need(byteLength, description);
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }
}

/**
 * Parse and fully validate a PTVB1 buffer without materialising tensor data.
 * Record and payload offsets refer to the supplied buffer.
 */
export function parseVoiceStatesBin(input) {
  const bytes = asBuffer(input, 'voices.bin');
  const reader = new Reader(bytes, 'voices.bin');

  if (reader.need(MAGIC.length, 'magic') !== MAGIC.length) {
    fail('voices.bin: truncated magic');
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail('voices.bin: invalid header (expected PTVB1)');
  }
  reader.offset = MAGIC.length;

  const voiceCount = reader.uint32('voice count');
  // A record needs a non-empty name and a tensor count. Reject impossible
  // counts before entering a loop controlled by untrusted data.
  if (voiceCount > Math.floor(reader.remaining() / 5)) {
    fail(`voices.bin: voice count ${voiceCount} exceeds the remaining record bytes`);
  }

  const voiceNames = new Set();
  const voices = [];
  for (let voiceIndex = 0; voiceIndex < voiceCount; voiceIndex += 1) {
    const recordOffset = reader.offset;
    const nameLength = reader.uint16(`voice ${voiceIndex} name length`);
    const name = reader.text(nameLength, `voice ${voiceIndex} name`);
    assertSafeIdentifier(name, `voices.bin voice ${voiceIndex} name`);
    if (voiceNames.has(name)) fail(`voices.bin: duplicate voice ${JSON.stringify(name)}`);
    voiceNames.add(name);

    const tensorCount = reader.uint16(`voice ${JSON.stringify(name)} tensor count`);
    // A tensor needs a non-empty key, dtype, rank, and byte length.
    if (tensorCount > Math.floor(reader.remaining() / 8)) {
      fail(
        `voices.bin: tensor count ${tensorCount} for voice ${JSON.stringify(name)} ` +
          'exceeds the remaining record bytes',
      );
    }

    const tensorKeys = new Set();
    const tensors = [];
    for (let tensorIndex = 0; tensorIndex < tensorCount; tensorIndex += 1) {
      const keyLength = reader.uint16(
        `voice ${JSON.stringify(name)} tensor ${tensorIndex} key length`,
      );
      const key = reader.text(
        keyLength,
        `voice ${JSON.stringify(name)} tensor ${tensorIndex} key`,
      );
      assertSafeIdentifier(key, `voices.bin tensor ${JSON.stringify(key)}`);
      if (tensorKeys.has(key)) {
        fail(
          `voices.bin: duplicate tensor ${JSON.stringify(key)} ` +
            `in voice ${JSON.stringify(name)}`,
        );
      }
      tensorKeys.add(key);

      const dtypeCode = reader.uint8(
        `voice ${JSON.stringify(name)} tensor ${JSON.stringify(key)} dtype`,
      );
      const dtype = DTYPES.get(dtypeCode);
      if (!dtype) {
        fail(
          `voices.bin: unsupported dtype code ${dtypeCode} in tensor ` +
            `${JSON.stringify(key)} of voice ${JSON.stringify(name)}`,
        );
      }

      const rank = reader.uint8(
        `voice ${JSON.stringify(name)} tensor ${JSON.stringify(key)} rank`,
      );
      const shape = [];
      let elementCount = 1;
      for (let dimensionIndex = 0; dimensionIndex < rank; dimensionIndex += 1) {
        const dimension = reader.uint32(
          `voice ${JSON.stringify(name)} tensor ${JSON.stringify(key)} shape ${dimensionIndex}`,
        );
        shape.push(dimension);
        if (dimension !== 0 && elementCount > Math.floor(Number.MAX_SAFE_INTEGER / dimension)) {
          fail(
            `voices.bin: shape product exceeds the safe integer range in tensor ` +
              `${JSON.stringify(key)} of voice ${JSON.stringify(name)}`,
          );
        }
        elementCount *= dimension;
      }

      if (elementCount > Math.floor(UINT32_MAX / dtype.byteWidth)) {
        fail(
          `voices.bin: shape payload exceeds uint32 byte length in tensor ` +
            `${JSON.stringify(key)} of voice ${JSON.stringify(name)}`,
        );
      }
      const expectedByteLength = elementCount * dtype.byteWidth;
      const byteLength = reader.uint32(
        `voice ${JSON.stringify(name)} tensor ${JSON.stringify(key)} byte length`,
      );
      if (byteLength !== expectedByteLength) {
        fail(
          `voices.bin: tensor ${JSON.stringify(key)} of voice ${JSON.stringify(name)} ` +
            `declares ${byteLength} payload bytes but dtype ${dtype.name} shape ` +
            `[${shape.join(', ')}] requires ${expectedByteLength}`,
        );
      }

      const payloadOffset = reader.offset;
      reader.payload(byteLength, `tensor ${JSON.stringify(key)} payload`);
      tensors.push({
        key,
        dtypeCode,
        dtype: dtype.name,
        shape,
        elementCount,
        byteLength,
        payloadOffset,
      });
    }

    voices.push({
      name,
      offset: recordOffset,
      length: reader.offset - recordOffset,
      tensors,
    });
  }

  if (reader.offset !== reader.length) {
    fail(`voices.bin: trailing data after the final record (${reader.remaining()} bytes)`);
  }

  return { magic: 'PTVB1', voiceCount, voices, byteLength: bytes.length };
}

function rejectUnsafeJsonKeys(value, label) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    for (const key of Object.keys(current)) {
      assertSafeIdentifier(key, label);
      pending.push(current[key]);
    }
  }
}

/** Parse the companion metadata used by pocket-tts-js, with fatal UTF-8. */
export function parseBundleMetadata(input) {
  const bytes = asBuffer(input, 'bundle.json');
  if (bytes.length > MAX_BUNDLE_BYTES) {
    fail(`bundle.json: exceeds the ${MAX_BUNDLE_BYTES}-byte safety limit`);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('bundle.json: not valid UTF-8');
  }

  let metadata;
  try {
    metadata = JSON.parse(text);
  } catch (error) {
    fail(`bundle.json: invalid JSON (${error.message})`);
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('bundle.json: root must be an object');
  }
  rejectUnsafeJsonKeys(metadata, 'bundle.json');

  if (!Object.hasOwn(metadata, 'predefined_voices') || !Array.isArray(metadata.predefined_voices)) {
    fail('bundle.json: predefined_voices must be an array');
  }
  const names = new Set();
  for (const name of metadata.predefined_voices) {
    if (typeof name !== 'string' || name.length === 0) {
      fail('bundle.json: predefined_voices entries must be non-empty strings');
    }
    assertSafeIdentifier(name, 'bundle.json predefined_voices');
    if (names.has(name)) fail(`bundle.json: duplicate predefined voice ${JSON.stringify(name)}`);
    names.add(name);
  }

  return { predefinedVoices: [...metadata.predefined_voices] };
}

export function isReleaseBundle(bundle) {
  return (
    bundle.predefinedVoices.length === SAFE_VOICE_NAMES.length &&
    SAFE_VOICE_NAMES.every((name) => bundle.predefinedVoices.includes(name))
  );
}

function assertReleaseBundle(bundle) {
  if (!isReleaseBundle(bundle)) {
    fail(
      'bundle.json: predefined_voices must contain exactly the safe allowlist ' +
        `[${SAFE_VOICE_NAMES.join(', ')}]; supply owner-reviewed release metadata`,
    );
  }
}

function missingAllowedVoices(parsed) {
  const present = new Set(parsed.voices.map((voice) => voice.name));
  return SAFE_VOICE_NAMES.filter((name) => !present.has(name));
}

function assertAllAllowedVoices(parsed) {
  const missing = missingAllowedVoices(parsed);
  if (missing.length > 0) {
    fail(`voices.bin: missing allowed voice(s): ${missing.join(', ')}`);
  }
}

function assertCanonicalAllowlist(parsed) {
  const names = parsed.voices.map((voice) => voice.name);
  if (
    names.length !== SAFE_VOICE_NAMES.length ||
    names.some((name, index) => name !== SAFE_VOICE_NAMES[index])
  ) {
    fail(
      'pruned voices.bin: records must be exactly the safe allowlist in canonical ' +
        `order [${SAFE_VOICE_NAMES.join(', ')}]`,
    );
  }
}

function dropReason(name) {
  return FORBIDDEN_VOICE_SET.has(name) ? 'forbidden-voice' : 'not-in-allowlist';
}

function recordSha256(sourceBytes, record) {
  return sha256Hex(sourceBytes.subarray(record.offset, record.offset + record.length));
}

function retainedMetadata(sourceRecord, outputRecord, sourceBytes) {
  if (sourceRecord.tensors.length !== outputRecord.tensors.length) {
    fail(`internal verification failed for voice ${JSON.stringify(sourceRecord.name)} tensors`);
  }
  const tensors = sourceRecord.tensors.map((tensor, index) => {
    const outputTensor = outputRecord.tensors[index];
    if (tensor.key !== outputTensor.key) {
      fail(`internal verification failed for voice ${JSON.stringify(sourceRecord.name)} key`);
    }
    return {
      key: tensor.key,
      dtypeCode: tensor.dtypeCode,
      dtype: tensor.dtype,
      shape: [...tensor.shape],
      elementCount: tensor.elementCount,
      byteLength: tensor.byteLength,
      sourcePayloadOffset: tensor.payloadOffset,
      outputPayloadOffset: outputTensor.payloadOffset,
    };
  });
  return {
    voice: sourceRecord.name,
    sourceOffset: sourceRecord.offset,
    sourceLength: sourceRecord.length,
    outputOffset: outputRecord.offset,
    outputLength: outputRecord.length,
    recordSha256: recordSha256(sourceBytes, sourceRecord),
    tensorCount: tensors.length,
    tensors,
  };
}

function droppedMetadata(sourceBytes, record) {
  return {
    voice: record.name,
    sourceOffset: record.offset,
    sourceLength: record.length,
    recordSha256: recordSha256(sourceBytes, record),
    tensorCount: record.tensors.length,
    reason: dropReason(record.name),
    tensors: record.tensors.map((tensor) => ({
      key: tensor.key,
      dtypeCode: tensor.dtypeCode,
      dtype: tensor.dtype,
      shape: [...tensor.shape],
      elementCount: tensor.elementCount,
      byteLength: tensor.byteLength,
      sourcePayloadOffset: tensor.payloadOffset,
    })),
  };
}

/**
 * Build the canonical output and reparse it. The retained record comparison is
 * against complete source byte slices, not reserialised tensor values.
 */
export function buildPrunedOutput(sourceBytes, parsed = parseVoiceStatesBin(sourceBytes)) {
  assertAllAllowedVoices(parsed);
  const source = asBuffer(sourceBytes, 'voices.bin');
  const byName = new Map(parsed.voices.map((voice) => [voice.name, voice]));
  const retained = SAFE_VOICE_NAMES.map((name) => byName.get(name));
  const dropped = parsed.voices.filter((voice) => !SAFE_VOICE_SET.has(voice.name));

  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(retained.length, MAGIC.length);

  const parts = [header];
  let outputLength = HEADER_BYTES;
  for (const record of retained) {
    outputLength = checkedAdd(outputLength, record.length, 'pruned voices.bin length');
    parts.push(source.subarray(record.offset, record.offset + record.length));
  }
  if (outputLength > bufferConstants.MAX_LENGTH) {
    fail('pruned voices.bin exceeds the Node Buffer length limit');
  }

  const outputBytes = Buffer.concat(parts, outputLength);
  const reparsed = parseVoiceStatesBin(outputBytes);
  assertCanonicalAllowlist(reparsed);

  const outputRecords = new Map(reparsed.voices.map((voice) => [voice.name, voice]));
  const retainedRecords = retained.map((record) => {
    const outputRecord = outputRecords.get(record.name);
    const sourceSlice = source.subarray(record.offset, record.offset + record.length);
    const outputSlice = outputBytes.subarray(
      outputRecord.offset,
      outputRecord.offset + outputRecord.length,
    );
    if (record.length !== outputRecord.length || !sourceSlice.equals(outputSlice)) {
      fail(`verification failed: retained bytes differ for voice ${JSON.stringify(record.name)}`);
    }
    return { record, outputRecord };
  });

  return {
    outputBytes,
    reparsed,
    retained: retainedRecords.map(({ record, outputRecord }) =>
      retainedMetadata(record, outputRecord, source),
    ),
    dropped: dropped.map((record) => droppedMetadata(source, record)),
  };
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildManifest({
  sourceBytes,
  sourceSha256,
  parsed,
  bundleBytes,
  bundleSha256,
  bundle,
  pruned,
}) {
  return {
    format: MANIFEST_FORMAT,
    manifestVersion: MANIFEST_VERSION,
    toolVersion: TOOL_VERSION,
    hashAlgorithm: 'sha-256',
    allowlist: [...SAFE_VOICE_NAMES],
    source: {
      sha256: sourceSha256,
      byteLength: sourceBytes.length,
      voiceCount: parsed.voiceCount,
    },
    bundle: {
      sha256: bundleSha256,
      byteLength: bundleBytes.length,
      predefinedVoices: [...bundle.predefinedVoices],
    },
    output: {
      sha256: sha256Hex(pruned.outputBytes),
      byteLength: pruned.outputBytes.length,
      voiceCount: pruned.reparsed.voiceCount,
    },
    retained: pruned.retained,
    dropped: pruned.dropped,
    verification: {
      outputReparsed: true,
      retainedSlicesByteIdentical: true,
      canonicalAllowlistOrder: true,
      exactEof: true,
    },
  };
}

export function inspectVoices({ sourceBytes, sourceSha256, bundleBytes, bundleSha256, bundle, parsed }) {
  return {
    format: 'readit-pocket-voices-inspection',
    toolVersion: TOOL_VERSION,
    source: {
      sha256: sourceSha256,
      byteLength: sourceBytes.length,
      voiceCount: parsed.voiceCount,
    },
    bundle: {
      sha256: bundleSha256,
      byteLength: bundleBytes.length,
      predefinedVoices: [...bundle.predefinedVoices],
      isReleaseAllowlist: isReleaseBundle(bundle),
    },
    missingAllowedVoices: missingAllowedVoices(parsed),
    voices: parsed.voices.map((voice) => ({
      voice: voice.name,
      offset: voice.offset,
      length: voice.length,
      allowed: SAFE_VOICE_SET.has(voice.name),
      recordSha256: recordSha256(sourceBytes, voice),
      tensorCount: voice.tensors.length,
      tensors: voice.tensors.map((tensor) => ({
        key: tensor.key,
        dtypeCode: tensor.dtypeCode,
        dtype: tensor.dtype,
        shape: [...tensor.shape],
        elementCount: tensor.elementCount,
        byteLength: tensor.byteLength,
        payloadOffset: tensor.payloadOffset,
      })),
    })),
  };
}

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : limit;
}

/** Rebuild the expected artifact and require the supplied bytes to match it. */
export function verifyPrunedOutput({
  sourceBytes,
  sourceSha256,
  parsed,
  bundleBytes,
  bundleSha256,
  bundle,
  outputBytes,
  outputSha256,
  manifestBytes,
}) {
  assertReleaseBundle(bundle);
  assertAllAllowedVoices(parsed);

  const output = asBuffer(outputBytes, 'pruned voices.bin');
  const reparsed = parseVoiceStatesBin(output);
  assertCanonicalAllowlist(reparsed);

  const pruned = buildPrunedOutput(sourceBytes, parsed);
  if (!output.equals(pruned.outputBytes)) {
    const offset = firstDifference(output, pruned.outputBytes);
    fail(`pruned voices.bin is not the canonical source-derived output (first difference at byte ${offset})`);
  }

  const actualOutputSha256 = outputSha256 ?? sha256Hex(output);
  const expectedManifest = buildManifest({
    sourceBytes,
    sourceSha256,
    parsed,
    bundleBytes,
    bundleSha256,
    bundle,
    pruned,
  });
  const expectedManifestBytes = Buffer.from(canonicalJson(expectedManifest), 'utf8');
  const manifest = asBuffer(manifestBytes, 'manifest');
  if (!manifest.equals(expectedManifestBytes)) {
    const offset = firstDifference(manifest, expectedManifestBytes);
    fail(`manifest is not the deterministic expected manifest (first difference at byte ${offset})`);
  }

  return {
    format: 'readit-pocket-voices-verification',
    toolVersion: TOOL_VERSION,
    verified: true,
    sourceSha256,
    bundleSha256,
    outputSha256: actualOutputSha256,
    retainedVoices: [...SAFE_VOICE_NAMES],
    droppedVoices: pruned.dropped.map((record) => record.voice),
    outputReparsed: true,
    retainedSlicesByteIdentical: true,
    manifestCanonical: true,
  };
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function assertDistinctPaths(entries) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      if (samePath(left.path, right.path)) {
        fail(`${left.label} and ${right.label} must be different files`);
      }
    }
  }
}

function readRequiredFile(path, label) {
  try {
    return readFileSync(path);
  } catch (error) {
    fail(`cannot read ${label} ${JSON.stringify(path)}: ${error.message}`);
  }
}

function atomicWrite(path, bytes) {
  const directory = dirname(path);
  const temporary = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // Preserve the original write error.
    }
    fail(`cannot write ${JSON.stringify(path)}: ${error.message}`);
  }
}

function loadAndValidateInputs(options) {
  assertDistinctPaths([
    { label: 'source', path: options.source },
    { label: 'bundle.json', path: options['bundle-json'] },
  ]);

  const sourceBytes = readRequiredFile(options.source, 'source');
  const sourceSha256 = assertSha256(sourceBytes, options['source-sha256'], 'source SHA-256');
  const parsed = parseVoiceStatesBin(sourceBytes);

  const bundleBytes = readRequiredFile(options['bundle-json'], 'bundle.json');
  const bundleSha256 = assertSha256(bundleBytes, options['bundle-sha256'], 'bundle.json SHA-256');
  const bundle = parseBundleMetadata(bundleBytes);

  return { sourceBytes, sourceSha256, parsed, bundleBytes, bundleSha256, bundle };
}

function parseCli(argv) {
  if (argv.length === 0) fail(`missing mode\n\n${USAGE}`);
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { help: true };
  if (argv.length === 1 && argv[0] === '--version') return { version: true };

  const mode = argv[0];
  const modes = new Set(['inspect', 'prune', 'verify']);
  if (!modes.has(mode)) fail(`unknown mode ${JSON.stringify(mode)}\n\n${USAGE}`);

  const allowed = new Set(['source', 'source-sha256', 'bundle-json', 'bundle-sha256']);
  const required = new Set(allowed);
  if (mode === 'prune') {
    allowed.add('output');
    allowed.add('manifest');
    required.add('output');
    required.add('manifest');
  }
  if (mode === 'verify') {
    allowed.add('input');
    allowed.add('manifest');
    allowed.add('input-sha256');
    required.add('input');
    required.add('manifest');
  }

  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!argument.startsWith('--')) fail(`unexpected argument ${JSON.stringify(argument)}\n\n${USAGE}`);
    const equals = argument.indexOf('=');
    const key = argument.slice(2, equals === -1 ? undefined : equals);
    if (!allowed.has(key)) fail(`unknown option --${key} for ${mode}\n\n${USAGE}`);
    if (Object.hasOwn(options, key)) fail(`duplicate option --${key}`);

    let value;
    if (equals !== -1) {
      value = argument.slice(equals + 1);
    } else {
      index += 1;
      if (index >= argv.length || argv[index].startsWith('--')) {
        fail(`option --${key} requires a value`);
      }
      value = argv[index];
    }
    if (value.length === 0) fail(`option --${key} requires a non-empty value`);
    options[key] = value;
  }

  for (const key of required) {
    if (!Object.hasOwn(options, key)) fail(`missing required option --${key}\n\n${USAGE}`);
  }
  // Validate all supplied hashes before touching output files.
  normalizeSha256(options['source-sha256'], '--source-sha256');
  normalizeSha256(options['bundle-sha256'], '--bundle-sha256');
  if (Object.hasOwn(options, 'input-sha256')) {
    normalizeSha256(options['input-sha256'], '--input-sha256');
  }

  return { mode, options };
}

function runCli(argv) {
  const command = parseCli(argv);
  if (command.help) return USAGE;
  if (command.version) return TOOL_VERSION;

  const { mode, options } = command;
  const inputs = loadAndValidateInputs(options);

  if (mode === 'inspect') {
    return canonicalJson(inspectVoices(inputs));
  }

  if (mode === 'prune') {
    assertDistinctPaths([
      { label: 'output', path: options.output },
      { label: 'manifest', path: options.manifest },
      { label: 'bundle.json', path: options['bundle-json'] },
    ]);
    assertDistinctPaths([
      { label: 'manifest', path: options.manifest },
      { label: 'source', path: options.source },
    ]);
    assertReleaseBundle(inputs.bundle);
    assertAllAllowedVoices(inputs.parsed);

    const pruned = buildPrunedOutput(inputs.sourceBytes, inputs.parsed);
    const manifest = buildManifest({ ...inputs, pruned });
    const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');

    atomicWrite(options.output, pruned.outputBytes);
    atomicWrite(options.manifest, manifestBytes);
    return canonicalJson(manifest);
  }

  assertDistinctPaths([
    { label: 'manifest', path: options.manifest },
    { label: 'input', path: options.input },
  ]);
  assertDistinctPaths([
    { label: 'manifest', path: options.manifest },
    { label: 'source', path: options.source },
  ]);
  assertDistinctPaths([
    { label: 'manifest', path: options.manifest },
    { label: 'bundle.json', path: options['bundle-json'] },
  ]);
  assertDistinctPaths([
    { label: 'input', path: options.input },
    { label: 'bundle.json', path: options['bundle-json'] },
  ]);
  const outputBytes = readRequiredFile(options.input, 'pruned voices.bin');
  const outputSha256 = Object.hasOwn(options, 'input-sha256')
    ? assertSha256(outputBytes, options['input-sha256'], 'input SHA-256')
    : undefined;
  const manifestBytes = readRequiredFile(options.manifest, 'manifest');
  const result = verifyPrunedOutput({
    ...inputs,
    outputBytes,
    outputSha256,
    manifestBytes,
  });
  return canonicalJson(result);
}

export function main(argv = process.argv.slice(2)) {
  try {
    const output = runCli(argv);
    if (output !== undefined) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof PocketVoicesError ? error.message : `unexpected error: ${error.message}`;
    process.stderr.write(`prune-pocket-voices: ${message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
