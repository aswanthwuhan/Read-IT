package app.readit.reader.kokoro;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The leading edge must be preserved; only an exact-zero tail may be trimmed. */
public class AudioEdgeTrimmerTest {

    private static final int RATE = 24000;

    @Test
    public void softOnsetAt300MsSurvivesUnchanged() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int speech = AudioEdgeTrimmer.samplesForMs(RATE, 100);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + 1 + speech + tail];
        // 0.006 is below sherpa's old 0.01 silence threshold: exactly the soft
        // f/s/h/th onset the old silence scaling deleted.
        input[lead] = 0.006f;
        for (int i = 0; i < speech; i++) input[lead + 1 + i] = 0.5f;
        input[lead + speech] = 0.006f; // soft fade just before the silent tail

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        // The full 300 ms lead-in stays in place; no leading sample is moved or dropped.
        assertEquals(0.006f, out[lead], 0f);
        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + 1 + speech + keptTail, out.length);
    }

    @Test
    public void quietSubThresholdInitialWordIsNeverTrimmed() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int quietWord = AudioEdgeTrimmer.samplesForMs(RATE, 200);
        int loudWord = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + quietWord + loudWord + tail];
        // A reduced opening vowel can be quieter than an amplitude-based silence
        // threshold. Treating it as padding used to keep only 80 ms of this 200 ms word.
        for (int i = 0; i < quietWord; i++) input[lead + i] = 0.0005f;
        for (int i = 0; i < loudWord; i++) input[lead + quietWord + i] = 0.5f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        for (int i = 0; i < lead + quietWord; i++) {
            assertEquals("leading sample " + i + " changed", input[i], out[i], 0f);
        }
        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + quietWord + loudWord + keptTail, out.length);
    }

    @Test
    public void entirelySubThresholdUtteranceIsPreserved() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int speech = AudioEdgeTrimmer.samplesForMs(RATE, 200);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + speech + tail];
        for (int i = 0; i < speech; i++) input[lead + i] = 0.0005f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        for (int i = 0; i < lead + speech; i++) {
            assertEquals("speech sample " + i + " changed", input[i], out[i], 0f);
        }
        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + speech + keptTail, out.length);
    }

    @Test
    public void quietFinalWordAfterLoudSpeechIsPreserved() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int loudWord = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        int quietWord = AudioEdgeTrimmer.samplesForMs(RATE, 200);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + loudWord + quietWord + tail];
        for (int i = 0; i < loudWord; i++) input[lead + i] = 0.5f;
        for (int i = 0; i < quietWord; i++) input[lead + loudWord + i] = 0.0005f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        for (int i = 0; i < lead + loudWord + quietWord; i++) {
            assertEquals("speech sample " + i + " changed", input[i], out[i], 0f);
        }
        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + loudWord + quietWord + keptTail, out.length);
    }

    @Test
    public void thousandMsSilentLeadIsPreserved() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 1000);
        float[] input = new float[lead + 1];
        input[lead] = 0.5f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        assertTrue(out == input);
        assertEquals(lead + 1, out.length);
        assertEquals(0.5f, out[lead], 0f);
    }

    @Test
    public void clipShorterThanTailGuardIsUntouched() {
        float[] shortClip = new float[AudioEdgeTrimmer.samplesForMs(RATE, 100)];
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(shortClip, RATE) == shortClip);
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(null, RATE) == null);
        assertTrue(AudioEdgeTrimmer.trimSilentEdges(new float[0], RATE).length == 0);
    }

    @Test
    public void silentTailIsStillReducedTo120Ms() {
        int lead = AudioEdgeTrimmer.samplesForMs(RATE, 300);
        int speech = AudioEdgeTrimmer.samplesForMs(RATE, 100);
        int tail = AudioEdgeTrimmer.samplesForMs(RATE, 500);
        float[] input = new float[lead + speech + tail];
        for (int i = 0; i < speech; i++) input[lead + i] = 0.5f;

        float[] out = AudioEdgeTrimmer.trimSilentEdges(input, RATE);

        int keptTail = AudioEdgeTrimmer.samplesForMs(RATE, AudioEdgeTrimmer.MIN_TAIL_MS);
        assertEquals(lead + speech + keptTail, out.length);
        assertEquals(0.5f, out[lead + speech - 1], 0f);
    }
}
