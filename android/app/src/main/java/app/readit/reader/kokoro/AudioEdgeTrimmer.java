package app.readit.reader.kokoro;

/**
 * Removes only the inaudible tail of a Kokoro clip.
 *
 * <p>sherpa's own silence scaling is disabled in {@link KokoroTtsEngine} because its 0.01
 * threshold also covers soft word onsets (f/s/h/th). Neither edge is trimmed with an
 * amplitude threshold: it cannot distinguish model padding from quiet, unstressed speech
 * such as "the", "A", "and", "of", or a whispered final word. The leading edge is therefore
 * never trimmed, and the tail removes only exact digital-zero samples.
 *
 * <p>The reader joins clips with a plain concatenation and inserts no pause of its own, so
 * a short exact-zero tail is retained to keep pacing.
 *
 * <p>Deliberately Android-free so it can be unit tested on the JVM, like {@link WavWriter}.
 */
public final class AudioEdgeTrimmer {

    /** Keep this much exact-zero tail as the pause between clauses. */
    static final int MIN_TAIL_MS = 120;

    private AudioEdgeTrimmer() {}

    static int samplesForMs(int sampleRate, int ms) {
        return (int) Math.round(sampleRate * (ms / 1000.0));
    }

    /**
     * Trim only an exact digital-zero tail, leaving {@link #MIN_TAIL_MS} after the last
     * non-zero sample. A clip with no removable tail is returned untouched.
     */
    static float[] trimSilentEdges(float[] samples, int sampleRate) {
        if (samples == null || samples.length == 0 || sampleRate <= 0) return samples;
        int keepTail = samplesForMs(sampleRate, MIN_TAIL_MS);
        if (keepTail <= 0 || samples.length <= keepTail) return samples;
        return trimTail(samples, keepTail);
    }

    private static float[] trimTail(float[] samples, int keepTail) {
        int tailStart = samples.length;
        while (tailStart > 0 && samples[tailStart - 1] == 0f) {
            tailStart--;
        }
        int cut = tailStart + keepTail;
        if (cut >= samples.length) return samples;
        float[] out = new float[cut];
        System.arraycopy(samples, 0, out, 0, cut);
        return out;
    }
}
