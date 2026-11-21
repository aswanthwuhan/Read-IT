package app.readit.reader.kokoro;

import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * Picks the ONNX intra-op thread count from the device's CPU frequency tiers.
 *
 * <p>Modern phones are big.LITTLE: a prime core, a few performance cores and a band of
 * efficiency cores. ONNX Runtime gains from filling the fast cores, but a thread that lands
 * on an efficiency core is 2&ndash;4x slower at the same clock and still gates every
 * parallel step, so counting all cores (or {@code availableProcessors}) over-subscribes the
 * session. The rule, borrowed from Marmalade TTS's {@code CpuClusterDetector}: use the cores
 * above the slowest frequency tier, and drop a lone prime core when at least two other fast
 * cores remain &mdash; Android often leaves the prime core out of the cpuset a background
 * reader runs in, so a 5-thread "4 mid + 1 prime" request puts one thread on a little core.
 *
 * <p>Each cluster is one {@code /sys/devices/system/cpu/cpufreq/policy*} directory:
 * {@code cpuinfo_max_freq} is its top frequency in kHz and {@code related_cpus} lists its
 * cores. When sysfs is unreadable (some vendors restrict it) the estimate is
 * {@code (availableProcessors + 1) / 2} &mdash; "roughly half the cores are fast" is the
 * usual shape. The result is always clamped to 1..8.
 */
public final class CpuClusterDetector {

    private static final String TAG = "CpuClusterDetector";
    private static final String CPUFREQ_ROOT = "/sys/devices/system/cpu/cpufreq";
    /** ORT gains flatten past this on phone-class hardware; more threads only add heat. */
    private static final int MAX_THREADS = 8;
    /** A lone prime core is left out only when this many other fast cores remain. */
    private static final int MIN_THREADS_WITHOUT_PRIME = 2;

    private CpuClusterDetector() {}

    /**
     * The intra-op thread count to load Kokoro with: {@link #threadsFor} clamped to 1..8,
     * or the {@link #fallbackEstimate} when cpufreq sysfs cannot be read.
     */
    public static int detectThreads() {
        List<Cluster> clusters = readClusters();
        int raw = threadsFor(clusters);
        int threads;
        if (raw > 0) {
            threads = Math.max(1, Math.min(MAX_THREADS, raw));
        } else {
            threads = Math.max(1, Math.min(MAX_THREADS, fallbackEstimate()));
            Log.w(TAG, "cpufreq sysfs unreadable; estimating from availableProcessors");
        }
        Log.i(TAG, "ONNX threads: " + threads + " (raw=" + raw + ", clusters=" + clusters
                + ", cores=" + Runtime.getRuntime().availableProcessors() + ")");
        return threads;
    }

    /** One CPU cluster as sysfs describes it: a top frequency and a core count. */
    static final class Cluster {
        final long maxFreqKhz;
        final int cpuCount;

        Cluster(long maxFreqKhz, int cpuCount) {
            this.maxFreqKhz = maxFreqKhz;
            this.cpuCount = cpuCount;
        }

        @Override
        public String toString() {
            return maxFreqKhz + "kHz x" + cpuCount;
        }
    }

    /** The device's CPU clusters, or an empty list when the sysfs layout is unreadable. */
    static List<Cluster> readClusters() {
        File root = new File(CPUFREQ_ROOT);
        File[] entries = root.listFiles();
        if (entries == null) {
            return new ArrayList<>();
        }
        // Policy order carries no meaning, but sorting keeps the log line stable.
        Arrays.sort(entries, Comparator.comparing(File::getName));
        List<Cluster> clusters = new ArrayList<>();
        for (File policy : entries) {
            if (!policy.isDirectory() || !policy.getName().startsWith("policy")) {
                continue;
            }
            Long maxFreqKhz = readLong(new File(policy, "cpuinfo_max_freq"));
            String relatedCpus = readText(new File(policy, "related_cpus"));
            if (maxFreqKhz == null || relatedCpus == null) {
                continue;
            }
            int cpuCount = countCpus(relatedCpus);
            if (cpuCount > 0) {
                clusters.add(new Cluster(maxFreqKhz, cpuCount));
            }
        }
        return clusters;
    }

    /**
     * Intra-op threads for a device with {@code clusters}: every core above the slowest
     * frequency tier, minus a lone top-tier core when at least
     * {@value #MIN_THREADS_WITHOUT_PRIME} other fast cores remain. A single-tier device uses
     * all its cores but one. Returns 0 &mdash; not a thread count &mdash; when {@code clusters}
     * is empty, so the caller can fall back to {@link #fallbackEstimate}.
     */
    static int threadsFor(List<Cluster> clusters) {
        if (clusters == null || clusters.isEmpty()) {
            return 0;
        }
        long minFreqKhz = Long.MAX_VALUE;
        int totalCores = 0;
        long topFreqKhz = Long.MIN_VALUE;
        int perfCores = 0;
        for (Cluster cluster : clusters) {
            minFreqKhz = Math.min(minFreqKhz, cluster.maxFreqKhz);
            totalCores += cluster.cpuCount;
        }
        for (Cluster cluster : clusters) {
            if (cluster.maxFreqKhz > minFreqKhz) {
                perfCores += cluster.cpuCount;
                topFreqKhz = Math.max(topFreqKhz, cluster.maxFreqKhz);
            }
        }
        if (perfCores == 0) {
            // Single-tier device (old Snapdragon 4xx etc.): all cores but one, leaving a
            // core for the OS scheduler.
            return Math.max(1, totalCores - 1);
        }
        int topCores = 0;
        for (Cluster cluster : clusters) {
            if (cluster.maxFreqKhz == topFreqKhz) {
                topCores += cluster.cpuCount;
            }
        }
        return topCores == 1 && perfCores - 1 >= MIN_THREADS_WITHOUT_PRIME
                ? perfCores - 1 : perfCores;
    }

    /** Half the cores, rounded up: the usual big.LITTLE split when sysfs says nothing. */
    private static int fallbackEstimate() {
        return (Runtime.getRuntime().availableProcessors() + 1) / 2;
    }

    /** Counts a cpumask list such as {@code "0 1 2 3"}, {@code "0,4-7"} or {@code "0-3"}. */
    private static int countCpus(String relatedCpus) {
        int count = 0;
        for (String token : relatedCpus.trim().split("[,\\s]+")) {
            if (token.isEmpty()) {
                continue;
            }
            int dash = token.indexOf('-');
            try {
                if (dash > 0 && dash < token.length() - 1) {
                    int first = Integer.parseInt(token.substring(0, dash));
                    int last = Integer.parseInt(token.substring(dash + 1));
                    if (last >= first) {
                        count += last - first + 1;
                    }
                } else {
                    Integer.parseInt(token);
                    count++;
                }
            } catch (NumberFormatException ignored) {
                // A kernel that prints something unexpected: skip the token, don't guess.
            }
        }
        return count;
    }

    private static Long readLong(File file) {
        String text = readText(file);
        if (text == null) {
            return null;
        }
        try {
            return Long.parseLong(text.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String readText(File file) {
        if (!file.isFile()) {
            return null;
        }
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            return reader.readLine();
        } catch (Exception e) {
            return null; // unreadable policy directory: no evidence, no cluster
        }
    }
}
