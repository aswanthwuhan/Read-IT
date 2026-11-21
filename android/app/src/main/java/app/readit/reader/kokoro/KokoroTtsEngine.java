package app.readit.reader.kokoro;

import android.content.res.AssetManager;
import android.os.SystemClock;
import android.util.Log;

import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.GenerationConfig;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;

import java.io.File;
import java.io.IOException;
import java.util.Locale;

import kotlin.jvm.functions.Function1;

/**
 * Owns the single {@link OfflineTts} instance and turns text into 16-bit PCM WAV bytes.
 *
 * <p>sherpa-onnx's Kokoro model is a 310&nbsp;MiB ONNX graph; constructing the runtime and
 * running inference are both CPU-bound and multi-second, so this class is a lazy
 * singleton that the plugin only touches from its background executor. Loading, generating
 * and releasing are all {@code synchronized}: one sentence at a time, never two ONNX
 * sessions fighting for the same four threads, and never a release racing a generation.
 *
 * <p>The read-only accessors ({@link #isLoaded()}, {@link #threads()},
 * {@link #sampleRate()}, {@link #voiceCount()}) read {@code volatile} fields instead of
 * entering the monitor, so the plugin's {@code status()} call answers immediately even
 * while a ten-second sentence is being generated.
 *
 * <p>The frontend is configured for sherpa-onnx 2.x: the English lexicon
 * {@code lexicon-en-us.txt} (staged into the model directory from the APK's assets) and
 * the model's {@code tokens.txt} drive pronunciation. The copyleft phonemiser that older
 * sherpa-onnx releases bundled as a fallback was removed upstream in 2.0.0 (PR #4055).
 */
public final class KokoroTtsEngine {

    private static final String TAG = "KokoroTts";
    private static final int DEFAULT_SAMPLE_RATE = 24000;

    /** Providers the prebuilt sherpa-onnx AAR actually contains; see {@link #clampProvider}. */
    public static final String DEFAULT_PROVIDER = "cpu";

    /** Cooperative cancellation for a generation already running inside sherpa-onnx. */
    public interface StopSignal {
        boolean isStopped();
    }

    /**
     * One synthesized sentence. The audio travels to JavaScript as {@link #wav} (a base64 string
     * on the bridge); nothing is written to disk, so there is no file path and no cache to prune.
     */
    public static final class SynthResult {
        public byte[] wav;
        public long durationMs;
        public int sampleRate;
        public int sampleCount;
        public long elapsedMs;
        public double rtf;
        /** True when {@link StopSignal} cut the generation short; no audio was produced. */
        public boolean cancelled;
    }

    private static KokoroTtsEngine instance;

    private volatile OfflineTts tts;
    private volatile int threads;
    private volatile int sampleRate = DEFAULT_SAMPLE_RATE;
    private volatile int voiceCount;
    private volatile String modelDirPath;
    /** Key of the model build in memory ({@code int8} / {@code fp32}); null when released. */
    private volatile String modelKey;
    private volatile String provider = DEFAULT_PROVIDER;
    /** Token symbols in the loaded model's tokens.txt; pre-phonemised input is checked against this. */
    private volatile java.util.Set<String> knownTokens = java.util.Collections.emptySet();

    private KokoroTtsEngine() {}

    public static synchronized KokoroTtsEngine getInstance() {
        if (instance == null) {
            instance = new KokoroTtsEngine();
        }
        return instance;
    }

    public boolean isLoaded() {
        return tts != null;
    }

    public int threads() {
        return threads;
    }

    /** Absolute path of the loaded model directory, or null when nothing is loaded. */
    public String modelDirPath() {
        return modelDirPath;
    }

    /** Key of the loaded model build ({@code int8} / {@code fp32}), or null when released. */
    public String modelKey() {
        return modelKey;
    }

    public int sampleRate() {
        return sampleRate;
    }

    public int voiceCount() {
        return voiceCount;
    }

    /**
     * Build the ONNX session. Re-loads only when the model directory or the thread count
     * actually changed, because loading costs several seconds and a few hundred MiB.
     */
    public synchronized void load(File modelDir, int threads, boolean debug)
            throws IOException {
        load(modelDir, threads, debug, DEFAULT_PROVIDER);
    }

    /**
     * Same as {@link #load(File, int, boolean)} but with an explicit ONNX Runtime execution
     * provider. Only {@code cpu}, {@code nnapi} and {@code xnnpack} are offered: those are
     * the only providers the prebuilt sherpa-onnx AAR compiles in (its GPU/QNN providers
     * need a custom build with {@code -DSHERPA_ONNX_ENABLE_GPU=ON}), and sherpa-onnx falls
     * back to cpu on its own when a provider cannot be enabled. Measured on the emulator,
     * nnapi and xnnpack are both slower than cpu for this graph, so cpu stays the default.
     */
    public synchronized void load(File modelDir, int threads, boolean debug, String provider)
            throws IOException {
        load(modelDir, KokoroModel.FP32, threads, debug, provider);
    }

    /**
     * Same as above, but for an explicit model build: the graph file name comes from the
     * {@link KokoroModel.Descriptor} (fp32 is {@code model.onnx}, int8 is
     * {@code model.int8.onnx}), so the two models can share this engine. The directory is
     * compared too, so loading the other model replaces the session instead of reusing it.
     */
    public synchronized void load(
            File modelDir, KokoroModel.Descriptor model, int threads, boolean debug, String provider)
            throws IOException {
        String path = modelDir.getAbsolutePath();
        String graph = model == null ? KokoroModel.MODEL_FILE : model.modelFile();
        int wanted = clampThreads(threads);
        String wantedProvider = clampProvider(provider);
        if (tts != null && wanted == this.threads && wantedProvider.equals(this.provider)
                && path.equals(modelDirPath)) {
            return;
        }
        release();

        OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
        kokoro.setModel(new File(modelDir, graph).getAbsolutePath());
        kokoro.setVoices(new File(modelDir, KokoroModel.VOICES_FILE).getAbsolutePath());
        kokoro.setTokens(new File(modelDir, KokoroModel.TOKENS_FILE).getAbsolutePath());
        // sherpa-onnx 2.x lexicon frontend: pronunciation comes from this lexicon (staged
        // from the APK assets) plus tokens.txt. The old dataDir setter is deprecated and
        // ignored; do not restore it — that backend was dropped in 2.0.0 (PR #4055).
        kokoro.setLexicon(new File(modelDir, KokoroModel.LEXICON_FILE).getAbsolutePath());

        OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
        modelConfig.setKokoro(kokoro);
        modelConfig.setNumThreads(wanted);
        modelConfig.setDebug(debug);
        modelConfig.setProvider(wantedProvider);

        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(modelConfig);
        config.setMaxNumSentences(1);
        // sherpa's GeneratedAudio::ScaleSilence() shortens any run with |sample| <= 0.01 that
        // lasts > 0.2 s down to 20% of its length. Kokoro emits ~300 ms of leading silence and
        // a soft consonant onset (f/s/h/th) stays under 0.01, so the two form one run and the
        // onset is deleted — on every chunk, because each clause is a separate generate() call.
        // 1f disables scaling entirely; do not lower this again (the inaudible edges are
        // handled separately by AudioEdgeTrimmer at a much lower -60 dBFS threshold).
        config.setSilenceScale(1f);

        Log.i(TAG, String.format(Locale.US,
                "Loading Kokoro from %s with %d threads, provider %s", path, wanted, wantedProvider));
        // A null AssetManager makes the Kotlin constructor read the model from files.
        OfflineTts created = new OfflineTts((AssetManager) null, config);
        this.threads = wanted;
        this.sampleRate = created.sampleRate() > 0 ? created.sampleRate() : DEFAULT_SAMPLE_RATE;
        this.voiceCount = created.numSpeakers();
        this.modelDirPath = path;
        this.modelKey = model == null ? KokoroModel.KEY_FP32 : model.key();
        this.provider = wantedProvider;
        this.knownTokens = readTokens(new File(modelDir, KokoroModel.TOKENS_FILE));
        this.tts = created;
        Log.i(TAG, String.format(Locale.US,
                "Kokoro ready: %d Hz, %d speakers", sampleRate, voiceCount));
    }

    /** First field of each tokens.txt line — the strings sherpa's token path expects. */
    private static java.util.Set<String> readTokens(File file) {
        java.util.Set<String> out = new java.util.HashSet<>();
        try {
            for (String line : java.nio.file.Files.readAllLines(
                    file.toPath(), java.nio.charset.StandardCharsets.UTF_8)) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                out.add(trimmed.split("\\s+", 2)[0]);
            }
        } catch (IOException | RuntimeException e) {
            Log.w(TAG, "could not read tokens.txt", e);
        }
        return java.util.Collections.unmodifiableSet(out);
    }

    /** Pre-phonemised tokens are only used when every one is in the model's vocabulary. */
    private boolean tokensUsable(String[][] tokens) {
        if (tokens == null || tokens.length == 0) return false;
        for (String[] sentence : tokens) {
            if (sentence == null || sentence.length == 0) return false;
            for (String token : sentence) {
                if (token == null || !knownTokens.contains(token)) return false;
            }
        }
        return true;
    }

    public synchronized void release() {
        OfflineTts current = tts;
        tts = null;
        knownTokens = java.util.Collections.emptySet();
        modelDirPath = null;
        modelKey = null;
        voiceCount = 0;
        sampleRate = DEFAULT_SAMPLE_RATE;
        if (current != null) {
            try {
                current.release();
            } catch (Throwable t) {
                Log.w(TAG, "release() failed", t);
            }
        }
    }

    /**
     * Synthesize one sentence into an in-memory 16-bit PCM WAV.
     *
     * <p>Nothing is written to disk: the caller ships {@link SynthResult#wav} over the bridge as
     * base64 and the WebView plays it from a blob URL, so a per-sentence file in cacheDir would
     * only cost write time and then need pruning.
     *
     * @param sid Kokoro speaker id (0..52), clamped into the model's range
     * @param speed 1.0 = natural pace (Kokoro's own speed control, faster than resampling)
     */
    public synchronized SynthResult synthesize(
            String text, int sid, float speed, StopSignal stop) throws IOException {
        return synthesize(text, sid, speed, stop, null);
    }

    /**
     * Same as above, but with tokens pre-phonemised by the app's G2P. sherpa's
     * token path skips its lexicon frontend, so Android reads the same "High",
     * "a", inflections and numbers as the web build. A token outside the
     * model's vocabulary, or a failed generation, falls back to raw text.
     */
    public synchronized SynthResult synthesize(
            String text, int sid, float speed, StopSignal stop, String[][] tokens)
            throws IOException {
        OfflineTts current = tts;
        if (current == null) {
            throw new IOException("Kokoro model is not loaded");
        }
        String trimmed = text == null ? "" : text.trim();
        if (trimmed.isEmpty()) {
            throw new IOException("Nothing to synthesize");
        }
        int speakers = current.numSpeakers();
        int speaker = sid;
        if (speakers > 0) {
            speaker = Math.max(0, Math.min(speakers - 1, sid));
        }
        float rate = speed <= 0f ? 1f : Math.max(0.5f, Math.min(2f, speed));

        long startNanos = SystemClock.elapsedRealtimeNanos();
        GeneratedAudio audio = null;
        final boolean useTokens = tokensUsable(tokens);
        if (useTokens) {
            try {
                GenerationConfig config = new GenerationConfig();
                config.setSid(speaker);
                config.setSpeed(rate);
                config.setTokens(tokens);
                if (stop != null) {
                    Function1<float[], Integer> callback = new Function1<float[], Integer>() {
                        @Override
                        public Integer invoke(float[] samples) {
                            return stop.isStopped() ? 0 : 1;
                        }
                    };
                    audio = current.generateWithConfigAndCallback(trimmed, config, callback);
                } else {
                    audio = current.generateWithConfig(trimmed, config);
                }
                if (audio == null || audio.getSamples() == null || audio.getSamples().length == 0) {
                    throw new IOException("Kokoro returned no audio from the token path");
                }
            } catch (Throwable t) {
                Log.w(TAG, "token path failed; falling back to text", t);
                audio = null;
            }
        }
        if (audio == null) {
            if (stop != null) {
                Function1<float[], Integer> callback = new Function1<float[], Integer>() {
                    @Override
                    public Integer invoke(float[] samples) {
                        return stop.isStopped() ? 0 : 1;
                    }
                };
                audio = current.generateWithCallback(trimmed, speaker, rate, callback);
            } else {
                audio = current.generate(trimmed, speaker, rate);
            }
        }
        long elapsedMs = (SystemClock.elapsedRealtimeNanos() - startNanos) / 1_000_000L;

        // stop() flips the signal mid-generation; the partial waveform is useless, and writing
        // it to the cache would only make the next sentence slower.
        if (stop != null && stop.isStopped()) {
            return cancelledResult();
        }
        if (audio == null) {
            throw new IOException("sherpa-onnx returned no audio");
        }

        float[] samples = audio.getSamples();
        int generatedRate =
                audio.getSampleRate() > 0 ? audio.getSampleRate() : current.sampleRate();
        if (samples == null || samples.length == 0) {
            throw new IOException("sherpa-onnx generated an empty waveform");
        }

        // Silence scaling is off (see load()), so Kokoro keeps both its ~300 ms lead-in and
        // its trailing silence on every clause. The reader concatenates clips back-to-back
        // and adds no pause of its own, so trim only the inaudible edges here; the -60 dBFS
        // threshold leaves a 0.006 soft attack untouched.
        samples = AudioEdgeTrimmer.trimSilentEdges(samples, generatedRate);

        byte[] wav = WavWriter.toBytes(samples, generatedRate);

        SynthResult result = new SynthResult();
        result.wav = wav;
        result.sampleRate = generatedRate;
        result.sampleCount = samples.length;
        result.durationMs = WavWriter.durationMs(samples.length, generatedRate);
        result.elapsedMs = elapsedMs;
        result.rtf = result.durationMs > 0 ? (elapsedMs / (double) result.durationMs) : 0.0;
        Log.i(TAG, String.format(Locale.US,
                "synthesized %d chars sid=%d speed=%.2f in %d ms -> %d ms audio (RTF %.2f)",
                trimmed.length(), speaker, rate, elapsedMs, result.durationMs, result.rtf));

        return result;
    }

    private SynthResult cancelledResult() {
        SynthResult result = new SynthResult();
        result.cancelled = true;
        result.sampleRate = sampleRate;
        return result;
    }

    static int clampThreads(int threads) {
        return Math.max(1, Math.min(8, threads));
    }

    /**
     * Only the execution providers compiled into the prebuilt sherpa-onnx AAR are allowed
     * through: the bundled libonnxruntime.so registers cpu, XNNPACK and NNAPI (its GPU,
     * QNN and CoreML providers are not in that build). Anything else would just make
     * sherpa-onnx print "available providers" and fall back to cpu, so it is rejected here
     * instead of silently costing a full model reload.
     */
    static String clampProvider(String provider) {
        if (provider == null) {
            return DEFAULT_PROVIDER;
        }
        switch (provider.trim().toLowerCase(Locale.US)) {
            case "nnapi":
                return "nnapi";
            case "xnnpack":
                return "xnnpack";
            default:
                return DEFAULT_PROVIDER;
        }
    }

    public String provider() {
        return provider;
    }
}
