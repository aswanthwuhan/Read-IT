package app.readit.reader.kokoro;

/**
 * Removes only the inaudible edges of a Kokoro clip.
 *
 * <p>sherpa's own silence scaling is disabled in {@link KokoroTtsEngine} because its 0.01
 * threshold also covers soft word onsets (f/s/h/th). That leaves both Kokoro's ~300 ms
 * lead-in and its trailing silence intact on every clause. The reader joins clips with a
 * plain concatenation and inserts no pause of its own, so trimming the silent edges here
 * keeps pacing. The -60 dBFS threshold is far below any voiced sample, so a 0.006 soft
 * attack survives and only genuine silence can be removed.
 *
 * <p>Deliberately Android-free so it can be unit tested on the JVM, like {@link WavWriter}.
 */
public final class AudioEdgeTrimmer {

    /** -60 dBFS (20*log10(0.001)); above the noise floor, below any speech. */
    static final float SILENCE_THRESHOLD = 0.001f;
    /** Keep this much lead-in before the first audible sample (natural pre-voicing). */
    static final int MIN_LEAD_MS = 80;
    /** Keep this much of the silent tail as the pause between clauses. */
    static final int MIN_TAIL_MS = 120;

    private AudioEdgeTrimmer() {}

    static int samplesForMs(int sampleRate, int ms) {
        return (int) Math.round(sampleRate * (ms / 1000.0));
    }

    /**
     * Trim the leading and trailing runs of near-silent samples, leaving {@link #MIN_LEAD_MS}
     * before the first audible sample and {@link #MIN_TAIL_MS} after the last one. A clip
     * shorter than the two guards together is returned untouched, as is one with nothing to
     * remove, so the common case allocates nothing.
     */
    static float[] trimSilentEdges(float[] samples, int sampleRate) {
        if (samples == null || samples.length == 0 || sampleRate <= 0) return samples;
        int keepLead = samplesForMs(sampleRate, MIN_LEAD_MS);
        int keepTail = samplesForMs(sampleRate, MIN_TAIL_MS);
        if (keepLead + keepTail <= 0 || samples.length <= keepLead + keepTail) return samples;

        // Sequential trims keep the guards from overlapping on an all-silent clip: trimming
        // the front first means the tail pass can never cut into the preserved pre-roll.
        return trimTail(trimLead(samples, keepLead), keepTail);
    }

    private static float[] trimLead(float[] samples, int keepLead) {
        int lead = 0;
        while (lead < samples.length && Math.abs(samples[lead]) <= SILENCE_THRESHOLD) {
            lead++;
        }
        int cut = lead - keepLead;
        if (cut <= 0) return samples;
        float[] out = new float[samples.length - cut];
        System.arraycopy(samples, cut, out, 0, out.length);
        return out;
    }

    private static float[] trimTail(float[] samples, int keepTail) {
        int tailStart = samples.length;
        while (tailStart > 0 && Math.abs(samples[tailStart - 1]) <= SILENCE_THRESHOLD) {
            tailStart--;
        }
        int cut = tailStart + keepTail;
        if (cut >= samples.length) return samples;
        float[] out = new float[cut];
        System.arraycopy(samples, 0, out, 0, cut);
        return out;
    }
}
