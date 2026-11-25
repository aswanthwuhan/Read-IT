# Pocket TTS voice pruning

`scripts/prune-pocket-voices.mjs` is a local-only maintenance tool for Pocket
TTS `voices.bin` assets. It removes every voice outside this fixed allowlist:

```
alba, azelma, eponine, fantine, javert, marius
```

The output order is always the order above. Complete retained PTVB1 record
bytes are copied unchanged; only the five-byte magic and uint32 voice count are
rewritten. The known non-commercial voices `cosette` and `jean` are dropped, as
is any unknown voice. Dropping a name is **not** rights evidence: the release
owner must still document the right to distribute each retained voice.

> This change adds a tool and tests only. It does not produce or publish an
> actual pruned release asset, change the app's Pocket integration, download a
> model, or establish voice licensing.

## Requirements and inputs

- Node.js 18 or newer. There are no npm dependencies, installs, or network calls.
- An owner-supplied, pinned source `voices.bin`.
- An owner-supplied, reviewed release `bundle.json`.
- The exact SHA-256 of both files, supplied explicitly on the command line.

The tool never infers a digest from an unverified sidecar. For `prune` and
`verify`, `bundle.json.predefined_voices` must contain exactly the six allowlist
names, with no duplicates or extras. Its order may differ; the binary output is
still canonical. This prevents publishing a pruned binary beside metadata that
still advertises forbidden or unknown voices. `inspect` can report on an
upstream full bundle, but `prune` and `verify` refuse it.

If the upstream `bundle.json` lists all source voices, the release owner must
prepare the reviewed companion metadata separately before pruning. This tool
intentionally does not rewrite model metadata.

## PTVB1 validation

The format is documented by
`node_modules/pocket-tts-js/src/binary.js:28-92`. All integers are little-endian.

| Field | Encoding |
|---|---|
| File magic | 5 bytes, ASCII `PTVB1` |
| Voice count | uint32 |
| Voice name length | uint16, followed by that many UTF-8 bytes |
| Tensor count | uint16 |
| Tensor key length | uint16, followed by that many UTF-8 bytes |
| Dtype | uint8: `0` float32, `1` int64, `2` bool |
| Rank | uint8 |
| Shape | `rank` uint32 dimensions |
| Payload byte length | uint32 |
| Payload | exactly that many bytes |

The parser is deliberately stricter than the runtime parser:

- Every read is bounds checked. Impossible voice/tensor counts, truncated
  fields, truncated payloads, and trailing bytes are fatal.
- Voice names and tensor keys use fatal UTF-8 decoding. Bundle JSON also uses
  fatal UTF-8 decoding.
- Duplicate voice names and duplicate tensor keys within a voice are fatal,
  including inside records that would later be dropped.
- Empty names/keys and `__proto__`, `constructor`, or `prototype` keys are
  rejected.
- Only dtype codes `0`, `1`, and `2` are accepted.
- Shape products use checked safe-integer arithmetic. The product times the
  dtype width (4, 8, or 1 bytes) must equal the encoded uint32 payload length.
- Parsing must consume the file exactly, with no bytes after the final record.

Every source record is validated before any output is written, even if that
record is forbidden or unknown.

## Compute explicit input hashes

PowerShell:

```powershell
$source = "C:\path\to\owner-supplied\voices.bin"
$bundle = "C:\path\to\owner-supplied\bundle.json"
$sourceHash = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
$bundleHash = (Get-FileHash $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
```

Cross-platform Node alternative:

```sh
node -e "const fs=require('node:fs'),c=require('node:crypto');for(const p of process.argv.slice(1))console.log(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),p)" voices.bin bundle.json
```

A matching digest proves that the bytes being processed are the bytes the
operator pinned. It does not prove provenance or grant redistribution rights.

## Inspect

Inspect all records without writing an output:

```sh
node scripts/prune-pocket-voices.mjs inspect \
  --source /path/to/voices.bin \
  --source-sha256 "$sourceHash" \
  --bundle-json /path/to/bundle.json \
  --bundle-sha256 "$bundleHash"
```

The JSON report includes source/bundle hashes, source record offsets and
lengths, tensor dtype/shape/payload metadata, record hashes, allowlist status,
dropped candidates, and any missing allowed voice. `inspect` is diagnostic: it
accepts an upstream bundle whose voice list is not yet release-safe.

## Prune

The output and manifest parent directories must already exist.

```sh
node scripts/prune-pocket-voices.mjs prune \
  --source /path/to/voices.bin \
  --source-sha256 "$sourceHash" \
  --bundle-json /path/to/bundle.json \
  --bundle-sha256 "$bundleHash" \
  --output /path/to/release/voices.bin \
  --manifest /path/to/release/voices.prune-manifest.json
```

Pruning fails if any allowed voice is missing or if the companion bundle is not
the exact release allowlist. Each output file is written through a temporary
sibling and atomic rename; validation failures leave existing outputs intact.
The binary and manifest are individually atomic, not a two-file transaction.
If a run is interrupted between the two renames, `verify` will reject the
mismatched pair.

The source and output may be the same path. That makes an already-pruned binary
safe to prune in place. The manifest must be distinct from the source, output,
and bundle; the output cannot overwrite the bundle.

## Manifest

The manifest is canonical UTF-8 JSON: two-space indentation, stable property
order, and one final newline. It contains no timestamps or filesystem paths, so
the same input bytes produce the same manifest bytes regardless of location.
It records:

- tool format/version and hash algorithm;
- the fixed allowlist;
- source and output SHA-256, byte lengths, and voice counts;
- bundle SHA-256, byte length, and `predefined_voices`;
- every retained voice's source/output offsets and lengths, whole-record
  SHA-256, tensor count, and tensor key/dtype/shape/element-count/payload
  metadata with source and output payload offsets;
- every dropped voice in source order, its offsets, record hash, tensor
  metadata, and drop reason;
- verification results for reparsing, byte-identical retained slices,
  canonical order, and exact EOF.

Pruning reparses the generated binary and compares each complete retained
record slice with the source bytes. It does not reserialize tensor values.

## Verify

```sh
node scripts/prune-pocket-voices.mjs verify \
  --source /path/to/voices.bin \
  --source-sha256 "$sourceHash" \
  --bundle-json /path/to/bundle.json \
  --bundle-sha256 "$bundleHash" \
  --input /path/to/release/voices.bin \
  --input-sha256 "$outputHash" \
  --manifest /path/to/release/voices.prune-manifest.json
```

`--input-sha256` is optional but recommended. Verification checks the explicit
source and bundle hashes, fully reparses the candidate, requires the exact
canonical allowlist/order, rebuilds the expected binary from source record
slices, compares every byte, and requires the manifest to equal the canonical
manifest rebuilt from those same inputs. Corruption, truncation, trailing data,
duplicates, a changed retained byte, a changed offset/hash/tool version, or even
non-canonical manifest formatting fails verification.

### Idempotence

Pruning an already-pruned binary with the same release bundle produces a
byte-identical binary and no dropped records. Its new manifest correctly records
the pruned binary's hash as both source and output hash, so the manifest itself
is not expected to remain byte-identical.

A practical finalization sequence is:

1. Prepare owner-reviewed release `bundle.json` containing only the six allowed
   voices.
2. Prune the pinned full source into a candidate binary and manifest.
3. Run `verify` against the original pinned source and reviewed bundle.
4. Optionally prune the candidate in place with its own hash to produce a final
   manifest whose source and output hashes match, then verify again.
5. Publish the verified binary, final bundle, manifest, and rights/provenance
   records together.

## Focused tests

```sh
node --check scripts/prune-pocket-voices.mjs
node --test scripts/prune-pocket-voices.test.mjs
```

The synthetic fixtures cover all three dtypes, scalar and zero-element tensors,
interleaved allowed/forbidden/unknown voices, canonical reordering, exact record
preservation, deterministic manifests, idempotence, inspect/prune/verify CLI
behavior, explicit hash failures, missing voices, duplicate voices/tensors,
unsafe keys, invalid UTF-8, malformed/truncated/trailing data, impossible counts,
shape-product overflow, payload-size mismatch, bundle metadata failures,
candidate corruption, and manifest tampering. No real model or voice asset is
needed.

## Release gate — still required

This tool is only one part of releasing a pruned Pocket voice asset. Before any
actual release asset is published, the owner must:

- [ ] Supply and pin the exact source files (immutable revision/URL plus
      SHA-256), and retain provenance for the transformation.
- [ ] Record per-voice rights evidence for `alba`, `azelma`, `eponine`,
      `fantine`, `javert`, and `marius`, including required attribution and any
      voice-specific terms. The allowlist is not a legal determination.
- [ ] Confirm that `cosette`, `jean`, and every other non-allowlisted record are
      absent from both the binary and the published `bundle.json` voice list.
- [ ] Host the final binary and companion metadata at an immutable,
      content-addressed or version-pinned URL, alongside the final manifest.
- [ ] Add app-side SHA-256 verification of downloaded `voices.bin` (and the
      reviewed bundle) before caching, exposing, or passing bytes to Pocket TTS.
      A correct local hash is not a substitute for runtime download verification.
- [ ] Bump the model/cache identity when the asset changes so old cached bytes
      cannot survive an update.
- [ ] Run real synthesis validation with the pinned app/runtime for every
      retained voice: load the voice, synthesize representative text, and check
      audible output, state/tensor compatibility, duration, pitch/quality, and
      failure behavior on the supported web/Android/iOS targets.
- [ ] Run `node --check`, the focused Node tests, and `verify` on the exact bytes
      to be hosted; archive the command inputs, hashes, and results.

## Limitations

- Structural correctness is not semantic correctness. The tool does not know
  the model's expected tensor names, ranks, or dimensions and cannot prove that
  a structurally valid voice will synthesize correctly.
- It does not inspect audio, evaluate voice quality, or perform synthesis.
- It does not determine licensing, provenance, or attribution sufficiency.
- It does not fetch files, modify Pocket runtime code, rewrite `bundle.json`, or
  publish assets.
- Files are read into memory and records are copied into a new buffer; this is
  not a streaming tool and is bounded by Node's Buffer/memory limits.
- Manifest verification is intentionally exact and tied to this tool version.
  A future format change must deliberately version and migrate manifests.
