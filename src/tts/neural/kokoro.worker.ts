/**
 * Kokoro-82M worker. Runs the vendored, espeak-free Kokoro engine
 * (transformers.js + onnxruntime-web) off the UI thread: ~300 MB of WASM memory
 * plus multi-second inference would freeze the reader otherwise. WebGPU when
 * the browser has it, WASM otherwise.
 */
import { env as transformersEnv } from '@huggingface/transformers';
import { warmLexicon } from '../kokoro/g2p/index.js';
import { KokoroTTS } from '../kokoro/kokoro.js';
import type { KokoroDevice, KokoroDtype, KokoroRequest, KokoroResponse } from './kokoroProtocol';
import { patchCachedKokoroModel } from './kokoroPhasePatch';
import { generateInPieces } from './modelText';
import { concatFloat32 } from './wav';
import { createProgressAggregator } from './progress';
import { ORT_BASE_URL } from './ort';
import { kokoroSizeMb } from './sizes';
import { wasmThreadCount } from './threadBudget';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Where transformers.js caches the fp32 weights (the only build the web engine loads). */
const MODEL_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model.onnx`;

/**
 * The worker's own URL is the base for the ORT runtime. Transformers.js imports
 * the Emscripten glue (`ort-wasm-simd-threaded.jsep.mjs`) dynamically at run
 * time; when the specifier is a root-relative path, Vite's dev server resolves
 * it into `public/` and refuses to serve it (`?import` → 500 "This file is in
 * /public ... should not be imported from source code"). Passing an absolute
 * URL — same bytes, same origin — keeps Vite's transform pipeline out of the
 * way and works identically in a production build, on Capacitor and on Pages.
 */
const ORT_WASM_BASE = new URL(ORT_BASE_URL, self.location.href).href;

/**
 * Point onnxruntime-web at the app's own `/ort/` copy before `from_pretrained()`
 * loads the runtime (transformers.js otherwise defaults it to a jsDelivr URL).
 * The weights still come from Hugging Face once, then live in Cache Storage
 * (`transformers-cache`, `kokoro-voices`), so a second launch is fully offline.
 * Threads use the same budget as Pocket so the RTF measurements are comparable.
 */
const onnxWasm = transformersEnv.backends.onnx.wasm;
if (onnxWasm) {
  onnxWasm.wasmPaths = ORT_WASM_BASE;
  onnxWasm.numThreads = wasmThreadCount();
}

/**
 * transformers.js caches the weights in Cache Storage (`transformers-cache`).
 * That is unavailable in private mode and in some old Android WebViews, where it
 * throws instead of downloading — opt out there and simply re-fetch. The flag is
 * on transformers.js' `env`; kokoro-js re-exports a narrower type for it.
 */
transformersEnv.useBrowserCache = typeof caches !== 'undefined';

interface WorkerScope {
  postMessage(message: KokoroResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<KokoroRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

function post(message: KokoroResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer ?? []);
}

let tts: KokoroTTS | null = null;
/** Request currently being synthesised; -1 once `stop` was received. */
let currentId = -1;
/**
 * Incremented on every `stop`. A queued message captures the epoch when it is
 * enqueued; if a `stop` lands before its turn, the epoch no longer matches and
 * the work is skipped. Without this, a prefetched `speak` queued before a stop
 * would reset `currentId` and render in full after the reader had stopped.
 */
let epoch = 0;
/** ONNX sessions are not re-entrant: init/speak run one after another. */
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event) => {
  const msg = event.data;
  // `stop` must act on the running synthesis immediately, not after a queue.
  if (msg.type === 'stop') {
    epoch++;
    currentId = -1;
    return;
  }
  // Capture the epoch now: a `stop` between enqueue and execution must cancel
  // this message even though it waits behind the current synthesis in `queue`.
  const capturedEpoch = epoch;
  queue = queue.then(() => handle(msg, capturedEpoch));
};

async function handle(msg: KokoroRequest, capturedEpoch: number): Promise<void> {
  // A stop superseded this message while it waited in the queue.
  if (capturedEpoch !== epoch) return;
  const id = msg.type === 'speak' ? msg.id : undefined;
  try {
    // `stop` is handled synchronously in onmessage and never reaches this queue.
    if (msg.type === 'init') await init(msg.dtype, msg.device);
    else if (msg.type === 'speak') await speak(msg.id, msg.text, msg.voice, msg.speed, capturedEpoch);
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

async function init(dtype: KokoroDtype, device: KokoroDevice): Promise<void> {
  if (tts) {
    post({ type: 'ready', voices: Object.keys(tts.voices) });
    return;
  }
  // Start the ~16 MB G2P dictionary fetch alongside the model download so the
  // first sentence does not pay for both in sequence.
  warmLexicon();
  const report = createProgressAggregator(
    (fraction) => post({ type: 'progress', fraction }),
    // The tokenizer lands first; without a known total the bar would read 99%
    // for the whole 92 MB weights download.
    kokoroSizeMb(dtype) * 1e6
  );
  // WebGPU evaluates the vocoder's sin() wrongly on large phases and the voice turns
  // into a whisper partway through a sentence; the cached weights get a phase wrap
  // (kokoroPhasePatch.ts). Already downloaded: patch before loading. First download:
  // the model is only in the cache after the load, so patch then and load again.
  const patch = (): Promise<boolean> =>
    device === 'webgpu' && dtype === 'fp32' ? patchCachedKokoroModel(MODEL_URL).catch(() => false) : Promise.resolve(false);
  try {
    await patch();
    tts = await load(dtype, device, report);
    if (await patch()) {
      await (tts as unknown as { model?: { dispose?: () => Promise<unknown> } }).model?.dispose?.();
      tts = await load(dtype, device, report);
    }
  } catch (err) {
    // WebGPU can be advertised but still fail (old driver, no adapter). Retry on
    // WASM with the same weights instead of leaving the engine unusable.
    if (device !== 'webgpu') throw err;
    tts = await load(dtype, 'wasm', report);
  }
  post({ type: 'ready', voices: Object.keys(tts.voices) });
}

async function load(
  dtype: KokoroDtype,
  device: KokoroDevice,
  report: (info: { label?: string; loaded?: number; total?: number }) => void
): Promise<KokoroTTS> {
  // The vendored engine is plain JS, so give the loader an explicit local type
  // instead of relying on its JSDoc (which `skipLibCheck` does not cover here).
  const fromPretrained = KokoroTTS.from_pretrained as unknown as (
    modelId: string,
    options: {
      dtype: KokoroDtype;
      device: KokoroDevice;
      progress_callback?: (info: { status?: string; file?: string; loaded?: number; total?: number }) => void;
    }
  ) => Promise<KokoroTTS>;
  return fromPretrained(MODEL_ID, {
    dtype,
    device,
    progress_callback: (info) => {
      if (info.status === 'progress') report({ label: info.file, loaded: info.loaded, total: info.total });
    },
  });
}

async function speak(id: number, text: string, voice: string, speed: number, capturedEpoch: number): Promise<void> {
  // Another `stop` may have landed between the handle() check and here.
  if (capturedEpoch !== epoch) return;
  const model = tts;
  if (!model) throw new Error('Kokoro model is not loaded');
  currentId = id;
  // kokoro-js tokenizes with `truncation: true` at the model's 510-token window,
  // so a long sentence handed to generate() simply loses its last words: the
  // audio stops where the tokens ran out. Speak it in pieces the window holds
  // and join the audio, which is what the native engine and Pocket already do.
  // `generateInPieces` skips the remaining pieces after a stop, so a stop mid
  // sentence costs one model call, not the whole rest of the sentence.
  const generated = await generateInPieces(
    text,
    async (piece) => {
      const audio = await model.generate(piece, { voice: voice as keyof KokoroTTS['voices'], speed });
      return { audio: audio.audio, sampleRate: audio.sampling_rate };
    },
    () => currentId !== id
  );
  if (!generated) {
    post({ type: 'stopped', id });
    return;
  }
  const pcm = concatFloat32(generated.parts);
  // Transfer instead of copy: a sentence is up to a few MB of Float32.
  post({ type: 'result', id, audio: pcm, sampleRate: generated.sampleRate }, [pcm.buffer as ArrayBuffer]);
}
