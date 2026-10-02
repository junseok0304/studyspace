package kr.omong.studyspace.study;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Adds seekable duration metadata to recorder output and builds bounded-memory waveforms. */
@Component
public class RecordingMediaProcessor {
    private static final int PEAK_COUNT = 1200;
    private static final int SAMPLE_RATE = 2000;
    private static final long PROCESS_TIMEOUT_SECONDS = 120;
    private final String ffmpeg;
    private final String ffprobe;

    public RecordingMediaProcessor(@Value("${STUDYSPACE_FFMPEG:ffmpeg}") String ffmpeg,
                                   @Value("${STUDYSPACE_FFPROBE:ffprobe}") String ffprobe) {
        this.ffmpeg = ffmpeg;
        this.ffprobe = ffprobe;
    }

    public record Processed(double durationSeconds, List<Double> peaks) {}

    public Processed process(Path media, String mimeType, double fallbackDuration) throws Exception {
        Path normalized = media.resolveSibling(media.getFileName() + ".normalized");
        double duration = fallbackDuration;
        try {
            List<String> command = new ArrayList<>(List.of(ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts", "-i", media.toString(), "-map", "0:a:0", "-c:a", "copy"));
            if (mimeType != null && mimeType.contains("mp4")) command.addAll(List.of("-movflags", "+faststart", "-f", "mp4"));
            else if (mimeType != null && mimeType.contains("ogg")) command.addAll(List.of("-f", "ogg"));
            else command.addAll(List.of("-f", "webm"));
            command.add(normalized.toString());
            if (run(command) == 0 && Files.isRegularFile(normalized) && Files.size(normalized) > 0) {
                double candidate = probeDuration(normalized);
                if (closeEnough(candidate, fallbackDuration)) {
                try { Files.move(normalized, media, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); }
                catch (java.nio.file.AtomicMoveNotSupportedException ignored) { Files.move(normalized, media, StandardCopyOption.REPLACE_EXISTING); }
                    duration = candidate;
                }
            }
        } catch (Exception ignored) {
            // Keep the original recording if the optional metadata repair is unavailable.
        } finally {
            Files.deleteIfExists(normalized);
        }

        if (!closeEnough(duration, fallbackDuration)) {
            double candidate = probeDuration(media);
            if (closeEnough(candidate, fallbackDuration)) duration = candidate;
            else duration = fallbackDuration;
        }
        return new Processed(duration, waveform(media, duration));
    }

    private boolean closeEnough(double actual, double expected) {
        return Double.isFinite(actual) && actual > 0 && actual <= 3600
                && Math.abs(actual - expected) <= Math.max(8, expected * 0.05);
    }

    private List<Double> waveform(Path media, double duration) throws Exception {
        double[] peaks = new double[PEAK_COUNT];
        long expectedSamples = Math.max(1, (long) Math.ceil(duration * SAMPLE_RATE));
        List<String> command = List.of(ffmpeg, "-hide_banner", "-loglevel", "error", "-i", media.toString(), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", Integer.toString(SAMPLE_RATE), "-f", "f32le", "pipe:1");
        Process process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        byte[] bytes = new byte[16 * 1024];
        long sample = 0;
        int carry = 0;
        try (var input = process.getInputStream()) {
            int read;
            while ((read = input.read(bytes, carry, bytes.length - carry)) != -1) {
                int available = carry + read;
                int usable = available - available % Float.BYTES;
                for (int offset = 0; offset < usable; offset += Float.BYTES, sample++) {
                    int bits = (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8)
                            | ((bytes[offset + 2] & 0xff) << 16) | (bytes[offset + 3] << 24);
                    float value = Float.intBitsToFloat(bits);
                    int bucket = (int) Math.min(PEAK_COUNT - 1, sample * PEAK_COUNT / expectedSamples);
                    if (Float.isFinite(value)) peaks[bucket] = Math.max(peaks[bucket], Math.min(1, Math.abs(value)));
                }
                carry = available - usable;
                if (carry > 0) System.arraycopy(bytes, usable, bytes, 0, carry);
            }
        }
        if (!process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IOException("녹음 파형 분석 시간이 초과됐습니다.");
        }
        if (process.exitValue() != 0 || sample == 0) throw new IOException("녹음 파형을 분석하지 못했습니다.");
        List<Double> result = new ArrayList<>(PEAK_COUNT);
        for (double peak : peaks) result.add(Math.round(peak * 10000d) / 10000d);
        return List.copyOf(result);
    }

    private double probeDuration(Path media) throws Exception {
        Process process = new ProcessBuilder(ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", media.toString())
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        byte[] output = process.getInputStream().readNBytes(128);
        if (!process.waitFor(15, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            return Double.NaN;
        }
        if (process.exitValue() != 0) return Double.NaN;
        try { return Double.parseDouble(new String(output).trim()); }
        catch (NumberFormatException ignored) { return Double.NaN; }
    }

    private int run(List<String> command) throws Exception {
        Process process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        if (!process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            return -1;
        }
        return process.exitValue();
    }
}
