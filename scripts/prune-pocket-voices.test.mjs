import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FORBIDDEN_VOICE_NAMES,
  PocketVoicesError,
  SAFE_VOICE_NAMES,
  TOOL_VERSION,
  buildPrunedOutput,
  canonicalJson,
  main,
  parseBundleMetadata,
  parseVoiceStatesBin,
  verifyPrunedOutput,
} from './prune-pocket-voices.mjs';

const scriptPath = fileURLToPath(new URL('./prune-pocket-voices.mjs', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const zeroHash = '0'.repeat(64);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function uint16(value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function uint32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function lengthPrefixed(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return Buffer.concat([uint16(bytes.length), bytes]);
}

function tensor({
  key = 'state',
  dtypeCode = 2,
  shape = [1],
  payload = Buffer.from([1]),
  declaredByteLength,
} = {}) {
  return Buffer.concat([
    lengthPrefixed(key),
    Buffer.from([dtypeCode, shape.length]),
    ...shape.map(uint32),
    uint32(declaredByteLength ?? payload.length),
    payload,
  ]);
}

function voice(name, tensors) {
  return Buffer.concat([
    lengthPrefixed(name),
    uint16(tensors.length),
    ...tensors,
  ]);
}

function ptvb(records, voiceCount = records.length) {
  return Buffer.concat([Buffer.from('PTVB1', 'ascii'), uint32(voiceCount), ...records]);
}

function allDTypes(prefix = 'state') {
  return [
    tensor({
      key: `${prefix}_float32`,
      dtypeCode: 0,
      shape: [1, 2],
      payload: Buffer.from(new Float32Array([1.5, -2.25]).buffer),
    }),
    tensor({
      key: `${prefix}_int64`,
      dtypeCode: 1,
      shape: [2],
      payload: Buffer.from(new BigInt64Array([7n, -9n]).buffer),
    }),
    tensor({
      key: `${prefix}_bool`,
      dtypeCode: 2,
      shape: [2, 2],
      payload: Buffer.from([0, 1, 1, 0]),
    }),
  ];
}

function defaultSource() {
  // Deliberately interleave allowed, known-forbidden, and unknown voices.
  const names = [
    'eponine',
    'cosette',
    'alba',
    'future_voice',
    'javert',
    'jean',
    'fantine',
    'azelma',
    'marius',
  ];
  return ptvb(
    names.map((name) =>
      voice(name, SAFE_VOICE_NAMES.includes(name) ? allDTypes() : [tensor({ key: 'extra' })]),
    ),
  );
}

function bundleBytes(voices = SAFE_VOICE_NAMES, extra = {}) {
  return Buffer.from(
    JSON.stringify({ sample_rate: 24000, predefined_voices: [...voices], ...extra }),
    'utf8',
  );
}

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), 'readit-pocket-voices-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function setup(t, { source = defaultSource(), bundle = bundleBytes() } = {}) {
  const directory = temporaryDirectory(t);
  const sourcePath = join(directory, 'voices.bin');
  const bundlePath = join(directory, 'bundle.json');
  writeFileSync(sourcePath, source);
  writeFileSync(bundlePath, bundle);
  return {
    directory,
    sourcePath,
    bundlePath,
    source,
    bundle,
    commonArgs: [
      '--source',
      sourcePath,
      '--source-sha256',
      sha256(source),
      '--bundle-json',
      bundlePath,
      '--bundle-sha256',
      sha256(bundle),
    ],
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.signal, null);
  return result.stdout;
}

function assertFailure(result, pattern) {
  assert.equal(result.status, 1, `expected failure; stdout=${result.stdout} stderr=${result.stderr}`);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, pattern);
}

function pruneFixture(t, fixture = setup(t)) {
  const outputPath = join(fixture.directory, 'pruned.bin');
  const manifestPath = join(fixture.directory, 'manifest.json');
  const stdout = assertSuccess(
    runCli(['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath]),
  );
  return {
    ...fixture,
    outputPath,
    manifestPath,
    output: readFileSync(outputPath),
    manifestBytes: readFileSync(manifestPath),
    manifest: JSON.parse(stdout),
  };
}

function recordSlice(bytes, parsed, name) {
  const record = parsed.voices.find((voiceRecord) => voiceRecord.name === name);
  assert.ok(record, `missing fixture record ${name}`);
  return bytes.subarray(record.offset, record.offset + record.length);
}

test('parser accepts all three dtypes and reports exact tensor metadata', () => {
  const bytes = defaultSource();
  const parsed = parseVoiceStatesBin(bytes);

  assert.equal(parsed.magic, 'PTVB1');
  assert.equal(parsed.voiceCount, 9);
  assert.equal(parsed.byteLength, bytes.length);
  assert.deepEqual(
    parsed.voices.map((record) => record.name),
    ['eponine', 'cosette', 'alba', 'future_voice', 'javert', 'jean', 'fantine', 'azelma', 'marius'],
  );

  let expectedOffset = 9;
  for (const record of parsed.voices) {
    assert.equal(record.offset, expectedOffset);
    assert.ok(record.length > 0);
    expectedOffset += record.length;
  }
  assert.equal(expectedOffset, bytes.length);

  const alba = parsed.voices.find((record) => record.name === 'alba');
  assert.deepEqual(
    alba.tensors.map(({ key, dtypeCode, dtype, shape, elementCount, byteLength }) => ({
      key,
      dtypeCode,
      dtype,
      shape,
      elementCount,
      byteLength,
    })),
    [
      { key: 'state_float32', dtypeCode: 0, dtype: 'float32', shape: [1, 2], elementCount: 2, byteLength: 8 },
      { key: 'state_int64', dtypeCode: 1, dtype: 'int64', shape: [2], elementCount: 2, byteLength: 16 },
      { key: 'state_bool', dtypeCode: 2, dtype: 'bool', shape: [2, 2], elementCount: 4, byteLength: 4 },
    ],
  );
  for (const item of alba.tensors) {
    assert.equal(
      bytes.subarray(item.payloadOffset, item.payloadOffset + item.byteLength).length,
      item.byteLength,
    );
  }
});

test('parser accepts scalar and zero-element tensors for every dtype', () => {
  const records = SAFE_VOICE_NAMES.map((name) =>
    voice(name, [
      tensor({ key: 'scalar_float', dtypeCode: 0, shape: [], payload: Buffer.from(new Float32Array([3.5]).buffer) }),
      tensor({ key: 'scalar_int', dtypeCode: 1, shape: [], payload: Buffer.from(new BigInt64Array([42n]).buffer) }),
      tensor({ key: 'scalar_bool', dtypeCode: 2, shape: [], payload: Buffer.from([1]) }),
      tensor({ key: 'empty_float', dtypeCode: 0, shape: [0, 3], payload: Buffer.alloc(0) }),
      tensor({ key: 'empty_int', dtypeCode: 1, shape: [4, 0], payload: Buffer.alloc(0) }),
      tensor({ key: 'empty_bool', dtypeCode: 2, shape: [0], payload: Buffer.alloc(0) }),
    ]),
  );
  const parsed = parseVoiceStatesBin(ptvb(records));
  for (const record of parsed.voices) {
    assert.deepEqual(record.tensors.map((item) => item.elementCount), [1, 1, 1, 0, 0, 0]);
    assert.deepEqual(record.tensors.map((item) => item.byteLength), [4, 8, 1, 0, 0, 0]);
  }
});

test('prune preserves complete retained records in canonical order and writes a deterministic manifest', (t) => {
  const fixture = pruneFixture(t);
  const sourceParsed = parseVoiceStatesBin(fixture.source);
  const outputParsed = parseVoiceStatesBin(fixture.output);

  assert.equal(outputParsed.voiceCount, SAFE_VOICE_NAMES.length);
  assert.equal(fixture.output.readUInt32LE(5), SAFE_VOICE_NAMES.length);
  assert.deepEqual(outputParsed.voices.map((record) => record.name), [...SAFE_VOICE_NAMES]);
  for (const name of SAFE_VOICE_NAMES) {
    assert.deepEqual(recordSlice(fixture.output, outputParsed, name), recordSlice(fixture.source, sourceParsed, name));
  }

  assert.equal(fixture.manifest.format, 'readit-pocket-voices-prune');
  assert.equal(fixture.manifest.manifestVersion, 1);
  assert.equal(fixture.manifest.toolVersion, TOOL_VERSION);
  assert.equal(fixture.manifest.hashAlgorithm, 'sha-256');
  assert.deepEqual(fixture.manifest.allowlist, [...SAFE_VOICE_NAMES]);
  assert.equal(fixture.manifest.source.sha256, sha256(fixture.source));
  assert.equal(fixture.manifest.source.voiceCount, 9);
  assert.equal(fixture.manifest.bundle.sha256, sha256(fixture.bundle));
  assert.deepEqual(fixture.manifest.bundle.predefinedVoices, [...SAFE_VOICE_NAMES]);
  assert.equal(fixture.manifest.output.sha256, sha256(fixture.output));
  assert.equal(fixture.manifest.output.byteLength, fixture.output.length);
  assert.equal(fixture.manifest.output.voiceCount, 6);
  assert.deepEqual(fixture.manifest.dropped.map((record) => record.voice), ['cosette', 'future_voice', 'jean']);
  assert.deepEqual(fixture.manifest.dropped.map((record) => record.reason), [
    'forbidden-voice',
    'not-in-allowlist',
    'forbidden-voice',
  ]);
  assert.deepEqual(fixture.manifest.retained.map((record) => record.voice), [...SAFE_VOICE_NAMES]);
  assert.deepEqual(fixture.manifest.verification, {
    outputReparsed: true,
    retainedSlicesByteIdentical: true,
    canonicalAllowlistOrder: true,
    exactEof: true,
  });

  let expectedOutputOffset = 9;
  for (const retained of fixture.manifest.retained) {
    const sourceRecord = sourceParsed.voices.find((record) => record.name === retained.voice);
    const outputRecord = outputParsed.voices.find((record) => record.name === retained.voice);
    assert.equal(retained.sourceOffset, sourceRecord.offset);
    assert.equal(retained.sourceLength, sourceRecord.length);
    assert.equal(retained.outputOffset, expectedOutputOffset);
    assert.equal(retained.outputOffset, outputRecord.offset);
    assert.equal(retained.outputLength, outputRecord.length);
    assert.equal(retained.recordSha256, sha256(recordSlice(fixture.source, sourceParsed, retained.voice)));
    expectedOutputOffset += retained.outputLength;
    for (let index = 0; index < retained.tensors.length; index += 1) {
      const item = retained.tensors[index];
      const sourceTensor = sourceRecord.tensors[index];
      const outputTensor = outputRecord.tensors[index];
      assert.equal(item.sourcePayloadOffset, sourceTensor.payloadOffset);
      assert.equal(item.outputPayloadOffset, outputTensor.payloadOffset);
      assert.equal(item.dtypeCode, sourceTensor.dtypeCode);
      assert.deepEqual(item.shape, sourceTensor.shape);
      assert.deepEqual(
        fixture.source.subarray(item.sourcePayloadOffset, item.sourcePayloadOffset + item.byteLength),
        fixture.output.subarray(item.outputPayloadOffset, item.outputPayloadOffset + item.byteLength),
      );
    }
  }
  assert.equal(expectedOutputOffset, fixture.output.length);
  assert.equal(fixture.manifestBytes.toString('utf8'), canonicalJson(fixture.manifest));
});

test('verify accepts a canonical prune and reports source, bundle, and output hashes', (t) => {
  const fixture = pruneFixture(t);
  const stdout = assertSuccess(
    runCli([
      'verify',
      ...fixture.commonArgs,
      '--input',
      fixture.outputPath,
      '--input-sha256',
      sha256(fixture.output),
      '--manifest',
      fixture.manifestPath,
    ]),
  );
  const result = JSON.parse(stdout);
  assert.equal(result.verified, true);
  assert.equal(result.sourceSha256, sha256(fixture.source));
  assert.equal(result.bundleSha256, sha256(fixture.bundle));
  assert.equal(result.outputSha256, sha256(fixture.output));
  assert.deepEqual(result.retainedVoices, [...SAFE_VOICE_NAMES]);
  assert.deepEqual(result.droppedVoices, ['cosette', 'future_voice', 'jean']);
  assert.equal(result.outputReparsed, true);
  assert.equal(result.retainedSlicesByteIdentical, true);
  assert.equal(result.manifestCanonical, true);
});

test('prune is deterministic across paths and byte-idempotent when rerun on its output', (t) => {
  const fixture = setup(t);
  const outputA = join(fixture.directory, 'a.bin');
  const outputB = join(fixture.directory, 'b.bin');
  const manifestA = join(fixture.directory, 'a.json');
  const manifestB = join(fixture.directory, 'b.json');
  assertSuccess(runCli(['prune', ...fixture.commonArgs, '--output', outputA, '--manifest', manifestA]));
  assertSuccess(runCli(['prune', ...fixture.commonArgs, '--output', outputB, '--manifest', manifestB]));
  assert.deepEqual(readFileSync(outputA), readFileSync(outputB));
  assert.deepEqual(readFileSync(manifestA), readFileSync(manifestB));

  const firstOutput = readFileSync(outputA);
  const inPlace = join(fixture.directory, 'in-place.bin');
  const secondManifest = join(fixture.directory, 'second.json');
  writeFileSync(inPlace, firstOutput);
  const stdout = assertSuccess(
    runCli([
      'prune',
      '--source',
      inPlace,
      '--source-sha256',
      sha256(firstOutput),
      ...fixture.commonArgs.slice(4),
      '--output',
      inPlace,
      '--manifest',
      secondManifest,
    ]),
  );
  const second = JSON.parse(stdout);
  assert.deepEqual(readFileSync(inPlace), firstOutput);
  assert.deepEqual(second.dropped, []);
  assert.equal(second.source.sha256, second.output.sha256);
  assert.equal(second.source.voiceCount, 6);
  assert.deepEqual(buildPrunedOutput(firstOutput).outputBytes, firstOutput);
  assertSuccess(
    runCli([
      'verify',
      '--source',
      inPlace,
      '--source-sha256',
      sha256(firstOutput),
      ...fixture.commonArgs.slice(4),
      '--input',
      inPlace,
      '--manifest',
      secondManifest,
    ]),
  );
});

test('inspect reports source order, dtype metadata, missing voices, and release-bundle status', (t) => {
  const fixture = setup(t);
  const stdout = assertSuccess(runCli(['inspect', ...fixture.commonArgs]));
  const result = JSON.parse(stdout);
  assert.equal(result.toolVersion, TOOL_VERSION);
  assert.equal(result.source.sha256, sha256(fixture.source));
  assert.equal(result.bundle.sha256, sha256(fixture.bundle));
  assert.equal(result.bundle.isReleaseAllowlist, true);
  assert.deepEqual(result.missingAllowedVoices, []);
  assert.deepEqual(result.voices.map((record) => record.voice), [
    'eponine',
    'cosette',
    'alba',
    'future_voice',
    'javert',
    'jean',
    'fantine',
    'azelma',
    'marius',
  ]);
  assert.equal(result.voices.find((record) => record.voice === 'cosette').allowed, false);
  assert.equal(result.voices.find((record) => record.voice === 'alba').tensors.length, 3);

  const fullBundle = bundleBytes([
    'eponine',
    'cosette',
    'alba',
    'future_voice',
    'javert',
    'jean',
    'fantine',
    'azelma',
    'marius',
  ]);
  const other = setup(t, { bundle: fullBundle });
  const inspected = JSON.parse(assertSuccess(runCli(['inspect', ...other.commonArgs])));
  assert.equal(inspected.bundle.isReleaseAllowlist, false);
  const outputPath = join(other.directory, 'out.bin');
  const manifestPath = join(other.directory, 'out.json');
  assertFailure(
    runCli(['prune', ...other.commonArgs, '--output', outputPath, '--manifest', manifestPath]),
    /predefined_voices must contain exactly the safe allowlist/,
  );
});

test('inspect can report a missing allowed voice while prune refuses to emit an incomplete bundle', (t) => {
  const parsed = parseVoiceStatesBin(defaultSource());
  const records = parsed.voices
    .filter((record) => record.name !== 'marius')
    .map((record) => recordSlice(defaultSource(), parsed, record.name));
  const source = ptvb(records);
  const fixture = setup(t, { source });
  const inspected = JSON.parse(assertSuccess(runCli(['inspect', ...fixture.commonArgs])));
  assert.deepEqual(inspected.missingAllowedVoices, ['marius']);

  const outputPath = join(fixture.directory, 'out.bin');
  const manifestPath = join(fixture.directory, 'out.json');
  assertFailure(
    runCli(['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath]),
    /missing allowed voice\(s\): marius/,
  );
  assert.throws(() => readFileSync(outputPath));
  assert.throws(() => readFileSync(manifestPath));
});

test('source and bundle digest mismatches are fatal before output is written', (t) => {
  const fixture = setup(t);
  const outputPath = join(fixture.directory, 'out.bin');
  const manifestPath = join(fixture.directory, 'out.json');
  const args = ['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath];

  const wrongSource = [...args];
  wrongSource[wrongSource.indexOf('--source-sha256') + 1] = zeroHash;
  assertFailure(runCli(wrongSource), /source SHA-256 mismatch/);

  const wrongBundle = [...args];
  wrongBundle[wrongBundle.indexOf('--bundle-sha256') + 1] = zeroHash;
  assertFailure(runCli(wrongBundle), /bundle\.json SHA-256 mismatch/);
  assert.throws(() => readFileSync(outputPath));
  assert.throws(() => readFileSync(manifestPath));
});

test('hashes must be explicit, well-formed, and not duplicated', (t) => {
  const fixture = setup(t);
  const outputPath = join(fixture.directory, 'out.bin');
  const manifestPath = join(fixture.directory, 'out.json');
  const args = ['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath];

  const missing = [...args];
  missing.splice(missing.indexOf('--source-sha256'), 2);
  assertFailure(runCli(missing), /missing required option --source-sha256/);

  const malformed = [...args];
  malformed[malformed.indexOf('--bundle-sha256') + 1] = 'abc';
  assertFailure(runCli(malformed), /--bundle-sha256 must be exactly 64 hexadecimal characters/);

  assertFailure(runCli([...args, '--source-sha256', zeroHash]), /duplicate option --source-sha256/);
});

test('verify rejects input digest mismatch, payload corruption, truncation, and trailing bytes', (t) => {
  const fixture = pruneFixture(t);
  const verifyArgs = [
    'verify',
    ...fixture.commonArgs,
    '--input',
    fixture.outputPath,
    '--manifest',
    fixture.manifestPath,
  ];

  const corrupted = Buffer.from(fixture.output);
  const parsed = parseVoiceStatesBin(corrupted);
  const payload = parsed.voices[0].tensors[0].payloadOffset;
  corrupted[payload] ^= 0xff;
  writeFileSync(fixture.outputPath, corrupted);
  assertFailure(runCli(verifyArgs), /not the canonical source-derived output/);
  assertFailure(
    runCli([...verifyArgs, '--input-sha256', sha256(corrupted)]),
    /not the canonical source-derived output/,
  );
  assertFailure(
    runCli([...verifyArgs, '--input-sha256', zeroHash]),
    /input SHA-256 mismatch/,
  );

  writeFileSync(fixture.outputPath, fixture.output.subarray(0, fixture.output.length - 1));
  assertFailure(runCli(verifyArgs), /truncated/);

  writeFileSync(fixture.outputPath, Buffer.concat([fixture.output, Buffer.from([0])]));
  assertFailure(runCli(verifyArgs), /trailing data/);
});

test('verify rejects duplicate voices and duplicate tensors in the candidate output', (t) => {
  const fixture = pruneFixture(t);
  const parsed = parseVoiceStatesBin(fixture.output);
  const records = parsed.voices.map((record) =>
    recordSlice(fixture.output, parsed, record.name),
  );
  const duplicateVoice = ptvb([...records, records[0]]);
  writeFileSync(fixture.outputPath, duplicateVoice);
  assertFailure(
    runCli([
      'verify',
      ...fixture.commonArgs,
      '--input',
      fixture.outputPath,
      '--manifest',
      fixture.manifestPath,
    ]),
    /duplicate voice/,
  );

  const duplicateTensorRecord = voice('alba', [tensor({ key: 'same' }), tensor({ key: 'same' })]);
  const replaced = [...records];
  replaced[0] = duplicateTensorRecord;
  writeFileSync(fixture.outputPath, ptvb(replaced));
  assertFailure(
    runCli([
      'verify',
      ...fixture.commonArgs,
      '--input',
      fixture.outputPath,
      '--manifest',
      fixture.manifestPath,
    ]),
    /duplicate tensor/,
  );
});

test('verify rejects a tampered or non-canonical manifest', (t) => {
  const fixture = pruneFixture(t);
  const args = [
    'verify',
    ...fixture.commonArgs,
    '--input',
    fixture.outputPath,
    '--manifest',
    fixture.manifestPath,
  ];

  writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  assertFailure(runCli(args), /manifest is not the deterministic expected manifest/);

  const changedOffset = structuredClone(fixture.manifest);
  changedOffset.retained[0].sourceOffset += 1;
  writeFileSync(fixture.manifestPath, canonicalJson(changedOffset));
  assertFailure(runCli(args), /manifest is not the deterministic expected manifest/);

  const changedVersion = structuredClone(fixture.manifest);
  changedVersion.toolVersion = '999.0.0';
  writeFileSync(fixture.manifestPath, canonicalJson(changedVersion));
  assertFailure(runCli(args), /manifest is not the deterministic expected manifest/);

  const unsafe = `{\n  "__proto__": {},\n  "format": "readit-pocket-voices-prune"\n}\n`;
  writeFileSync(fixture.manifestPath, unsafe);
  assertFailure(runCli(args), /manifest is not the deterministic expected manifest/);
});

test('direct verification proves retained slices and idempotence', () => {
  const source = defaultSource();
  const bundle = bundleBytes();
  const parsed = parseVoiceStatesBin(source);
  const pruned = buildPrunedOutput(source, parsed);
  const result = verifyPrunedOutput({
    sourceBytes: source,
    sourceSha256: sha256(source),
    parsed,
    bundleBytes: bundle,
    bundleSha256: sha256(bundle),
    bundle: parseBundleMetadata(bundle),
    outputBytes: pruned.outputBytes,
    manifestBytes: Buffer.from(
      canonicalJson({
        format: 'readit-pocket-voices-prune',
        manifestVersion: 1,
        toolVersion: TOOL_VERSION,
        hashAlgorithm: 'sha-256',
        allowlist: [...SAFE_VOICE_NAMES],
        source: { sha256: sha256(source), byteLength: source.length, voiceCount: parsed.voiceCount },
        bundle: {
          sha256: sha256(bundle),
          byteLength: bundle.length,
          predefinedVoices: [...SAFE_VOICE_NAMES],
        },
        output: {
          sha256: sha256(pruned.outputBytes),
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
      }),
    ),
  });
  assert.equal(result.verified, true);
  assert.deepEqual(buildPrunedOutput(pruned.outputBytes).outputBytes, pruned.outputBytes);
});

test('every truncated prefix is rejected and exact EOF is enforced', () => {
  const bytes = defaultSource();
  for (let length = 0; length < bytes.length; length += 1) {
    assert.throws(
      () => parseVoiceStatesBin(bytes.subarray(0, length)),
      PocketVoicesError,
      `prefix length ${length} should fail`,
    );
  }
  assert.doesNotThrow(() => parseVoiceStatesBin(bytes));
  assert.throws(
    () => parseVoiceStatesBin(Buffer.concat([bytes, Buffer.from([0, 0, 0])])),
    /trailing data/,
  );
});

test('impossible voice and tensor counts fail without unbounded loops', () => {
  assert.throws(
    () => parseVoiceStatesBin(Buffer.concat([Buffer.from('PTVB1'), uint32(0xffffffff)])),
    /voice count .* exceeds/,
  );
  const noTensors = Buffer.concat([
    Buffer.from('PTVB1'),
    uint32(1),
    lengthPrefixed('alba'),
    uint16(0xffff),
  ]);
  assert.throws(() => parseVoiceStatesBin(noTensors), /tensor count .* exceeds/);
});

test('duplicate voices are rejected even when the duplicate would be dropped', () => {
  const duplicate = voice('cosette', [tensor()]);
  assert.throws(() => parseVoiceStatesBin(ptvb([duplicate, duplicate])), /duplicate voice "cosette"/);
});

test('duplicate tensor keys are rejected in allowed and forbidden voices', () => {
  const allowed = voice('alba', [tensor({ key: 'same' }), tensor({ key: 'same' })]);
  assert.throws(() => parseVoiceStatesBin(ptvb([allowed])), /duplicate tensor "same"/);

  const forbidden = voice('cosette', [tensor({ key: 'same' }), tensor({ key: 'same' })]);
  assert.throws(() => parseVoiceStatesBin(ptvb([forbidden])), /duplicate tensor "same"/);
});

test('unsupported dtype codes are rejected in every record', () => {
  for (const name of ['alba', 'cosette', 'future_voice']) {
    assert.throws(
      () => parseVoiceStatesBin(ptvb([voice(name, [tensor({ dtypeCode: 3 })])])),
      /unsupported dtype code 3/,
    );
  }
});

test('shape products and payload lengths are validated with safe integer arithmetic', () => {
  const cases = [
    {
      label: 'short float payload',
      record: voice('alba', [tensor({ dtypeCode: 0, shape: [2], payload: Buffer.alloc(4) })]),
      pattern: /declares 4 payload bytes.*requires 8/,
    },
    {
      label: 'long float payload',
      record: voice('alba', [tensor({ dtypeCode: 0, shape: [1], payload: Buffer.alloc(8) })]),
      pattern: /declares 8 payload bytes.*requires 4/,
    },
    {
      label: 'misaligned int64 payload',
      record: voice('alba', [tensor({ dtypeCode: 1, shape: [1], payload: Buffer.alloc(7) })]),
      pattern: /declares 7 payload bytes.*requires 8/,
    },
    {
      label: 'unsafe product',
      record: voice('alba', [tensor({ dtypeCode: 2, shape: [0xffffffff, 0xffffffff], payload: Buffer.alloc(0) })]),
      pattern: /shape product exceeds the safe integer range/,
    },
    {
      label: 'payload beyond uint32',
      record: voice('alba', [tensor({ dtypeCode: 0, shape: [0x10000, 0x10000], payload: Buffer.alloc(0) })]),
      pattern: /shape payload exceeds uint32 byte length/,
    },
    {
      label: 'truncated payload',
      record: voice('alba', [tensor({ dtypeCode: 0, shape: [1], payload: Buffer.alloc(0), declaredByteLength: 4 })]),
      pattern: /truncated while reading tensor "state" payload/,
    },
  ];
  for (const item of cases) {
    assert.throws(() => parseVoiceStatesBin(ptvb([item.record])), item.pattern, item.label);
  }
});

test('truncated shape dimensions and byte-length fields are rejected', () => {
  const prefix = Buffer.concat([
    lengthPrefixed('alba'),
    uint16(1),
    lengthPrefixed('state'),
    Buffer.from([2, 2]),
    uint32(1),
  ]);
  const missingDimension = ptvb([prefix]);
  assert.throws(() => parseVoiceStatesBin(missingDimension), /truncated while reading .* shape 1/);

  const missingByteLength = ptvb([Buffer.concat([prefix, uint32(1), uint16(0)])]);
  assert.throws(() => parseVoiceStatesBin(missingByteLength), /truncated while reading .* byte length/);
});

test('invalid UTF-8 in voice names, tensor keys, and bundle metadata is fatal', () => {
  assert.throws(
    () => parseVoiceStatesBin(ptvb([voice(Buffer.from([0xff]), [tensor()])])),
    /voice 0 name.*not valid UTF-8/,
  );
  assert.throws(
    () => parseVoiceStatesBin(ptvb([voice('alba', [tensor({ key: Buffer.from([0xc0, 0xaf]) })])])),
    /tensor 0 key.*not valid UTF-8/,
  );
  assert.throws(() => parseBundleMetadata(Buffer.from([0x7b, 0xff, 0x7d])), /not valid UTF-8/);
});

test('empty and prototype-sensitive voice/tensor keys are rejected', () => {
  assert.throws(() => parseVoiceStatesBin(ptvb([voice('', [tensor()])])), /name must not be empty/);
  assert.throws(
    () => parseVoiceStatesBin(ptvb([voice('alba', [tensor({ key: '' })])])),
    /key must not be empty/,
  );
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => parseVoiceStatesBin(ptvb([voice(key, [tensor()])])), /forbidden key/);
    assert.throws(
      () => parseVoiceStatesBin(ptvb([voice('alba', [tensor({ key })])])),
      /forbidden key/,
    );
  }
});

test('bundle metadata rejects malformed JSON, unsafe keys, and invalid voice lists', () => {
  const cases = [
    [Buffer.from('{'), /invalid JSON/],
    [Buffer.from('[]'), /root must be an object/],
    [Buffer.from('{}'), /predefined_voices must be an array/],
    [Buffer.from('{"predefined_voices":["alba","alba"]}'), /duplicate predefined voice/],
    [Buffer.from('{"predefined_voices":[1]}'), /non-empty strings/],
    [Buffer.from('{"predefined_voices":[""]}'), /non-empty strings/],
    [Buffer.from('{"predefined_voices":["__proto__"]}'), /forbidden key/],
    [Buffer.from('{"__proto__":{},"predefined_voices":[]}'), /forbidden key/],
    [Buffer.from('{"nested":{"constructor":{}},"predefined_voices":[]}'), /forbidden key/],
  ];
  for (const [bytes, pattern] of cases) {
    assert.throws(() => parseBundleMetadata(bytes), pattern);
  }
});

test('release bundle must contain every allowed voice and no extra voices', (t) => {
  for (const voices of [
    SAFE_VOICE_NAMES.filter((name) => name !== 'javert'),
    [...SAFE_VOICE_NAMES, 'cosette'],
    [...SAFE_VOICE_NAMES, 'future_voice'],
  ]) {
    const fixture = setup(t, { bundle: bundleBytes(voices) });
    const outputPath = join(fixture.directory, 'out.bin');
    const manifestPath = join(fixture.directory, 'out.json');
    assertFailure(
      runCli(['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath]),
      /predefined_voices must contain exactly the safe allowlist/,
    );
  }
});

test('bundle voice order does not affect canonical output order', (t) => {
  const fixture = setup(t, { bundle: bundleBytes([...SAFE_VOICE_NAMES].reverse()) });
  const pruned = pruneFixture(t, fixture);
  assert.deepEqual(parseVoiceStatesBin(pruned.output).voices.map((record) => record.name), [
    ...SAFE_VOICE_NAMES,
  ]);
  assert.deepEqual(pruned.manifest.bundle.predefinedVoices, [...SAFE_VOICE_NAMES].reverse());
});

test('failed pruning leaves an existing output and an in-place source untouched', (t) => {
  const malformed = ptvb([voice('alba', [tensor({ dtypeCode: 9 })])]);
  const fixture = setup(t, { source: malformed });
  const outputPath = join(fixture.directory, 'out.bin');
  const manifestPath = join(fixture.directory, 'out.json');
  writeFileSync(outputPath, Buffer.from('keep-me'));
  assertFailure(
    runCli(['prune', ...fixture.commonArgs, '--output', outputPath, '--manifest', manifestPath]),
    /unsupported dtype code 9/,
  );
  assert.equal(readFileSync(outputPath).toString(), 'keep-me');
  assert.throws(() => readFileSync(manifestPath));

  const inPlace = setup(t, { bundle: bundleBytes([...SAFE_VOICE_NAMES, 'cosette']) });
  const before = readFileSync(inPlace.sourcePath);
  assertFailure(
    runCli([
      'prune',
      ...inPlace.commonArgs,
      '--output',
      inPlace.sourcePath,
      '--manifest',
      join(inPlace.directory, 'manifest.json'),
    ]),
    /safe allowlist/,
  );
  assert.deepEqual(readFileSync(inPlace.sourcePath), before);
});

test('CLI validates modes, options, values, and mutually distinct file roles', (t) => {
  const fixture = setup(t);
  const outputPath = join(fixture.directory, 'out.bin');
  const manifestPath = join(fixture.directory, 'out.json');

  assertFailure(runCli([]), /missing mode/);
  assertFailure(runCli(['unknown']), /unknown mode/);
  assertFailure(runCli(['inspect', '--unknown', 'x']), /unknown option/);
  assertFailure(runCli(['inspect', ...fixture.commonArgs, 'extra']), /unexpected argument/);
  assertFailure(runCli(['inspect', '--source']), /requires a value/);
  assertFailure(runCli(['inspect', '--source=']), /non-empty value/);
  assert.match(assertSuccess(runCli(['--help'])), /Usage:/);
  assert.equal(assertSuccess(runCli(['--version'])).trim(), TOOL_VERSION);

  assertFailure(
    runCli([
      'prune',
      ...fixture.commonArgs,
      '--output',
      fixture.bundlePath,
      '--manifest',
      manifestPath,
    ]),
    /output and bundle\.json must be different files/,
  );
  assertFailure(
    runCli([
      'prune',
      ...fixture.commonArgs,
      '--output',
      outputPath,
      '--manifest',
      fixture.sourcePath,
    ]),
    /manifest and source must be different files/,
  );
});

test('exported main returns status codes without throwing on user errors', () => {
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;
  const stdout = [];
  const stderr = [];
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    assert.equal(main(['--version']), 0);
    assert.equal(main(['not-a-mode']), 1);
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
  assert.equal(stdout.join(''), `${TOOL_VERSION}\n`);
  assert.match(stderr.join(''), /unknown mode/);
});

test('known forbidden names are documented as drops, not interpreted as rights evidence', () => {
  assert.deepEqual([...FORBIDDEN_VOICE_NAMES], ['cosette', 'jean']);
  const parsed = parseVoiceStatesBin(defaultSource());
  const pruned = buildPrunedOutput(defaultSource(), parsed);
  assert.deepEqual(
    pruned.dropped.filter((record) => record.reason === 'forbidden-voice').map((record) => record.voice),
    ['cosette', 'jean'],
  );
});
