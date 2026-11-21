package app.readit.reader.kokoro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/** Both edges must be trimmed without touching a soft attack or any audible sample. */
public class AudioEdgeTrimmerTest {

    private static final int RATE = 24000;

    @Test
    public void softOnsetAt300MsSurvivesLeadingTrim() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int speech = AudioEdgeTrimmer.samplesForMs(RATE, 100);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + 1 + speech + tail];
        // 0.006 is above our -60 dBFS trim threshold but below sherpa's 0.01: exactly the
        // soft f/s/h/th onset the old silence scaling deleted.
        input[lead] = 0.006f;
        for (int i = 0; i < speech; i++) input[lead + 1 + i] = 0.5f;
        input[lead + speech] = 0.006f; // soft fade just before the silent tail

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        int keptLead = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_LEAD_MS);
        // The onset moves from 300 ms to exactly the 80 ms pre-roll we keep; it is not
        // pulled earlier, and no audible sample is dropped by either edge.
        assertEquals(0.006f, out[keptLead], 0f);
        assertAudibleSamplesPreserved(input, out);
        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(keptLead + 1 + speech + keptTail, out.length);
    }

    @Test
    public void thousandMsSilentLeadShrinksToAbout80Ms() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 1000);
        float[] input = new float[lead + 1];
        input[lead] = 0.5f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        int keptLead = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_LEAD_MS);
        assertEquals(keptLead + 1, out.length);
        assertEquals(0.5f, out[keptLead], 0f);
    }

    @Test
    public void clipShorterThanCombinedGuardsIsUntouched() {
        float[] shortClip = new float[AudioEdgeTrimmer.samplesForMs(RATE, 199)];
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(shortClip, RATE) == shortClip);
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(null, RATE) == null);
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(new float[0], RATE).length == 0);
    }

    @Test
    public void silentTailIsStillReducedTo120Ms() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_LEAD_MS);
        int speech = AudioEdgeTrimmer.samplesForMs(RATE, 100);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + speech + tail];
        for (int i = 0; i < speech; i++) input[lead + i] = 0.5f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + speech + keptTail, out.length);
        assertEquals(0.5f, out[lead + speech - 1], 0f);
    }

    /** No sample above the -60 dBFS threshold may be dropped by either edge trim. */
    private static void assertAudibleSamplesPreserved(float[] input, float[] output) {
        assertEquals(audible(input), audible(output));
    }

    private static List<Float> audible(float[] samples) {
        List<Float> out = new ArrayList<>();
        for (float sample : samples) {
            if (Math.abs(sample) > AudioEdgeTrimmer.SILENCE_THRESHOLD) out.add(sample);
        }
        return out;
    }
}
