package kr.omong.studyspace.study;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Extracts readable source passages for development-mode study previews. */
final class MockStudyContent {
    private MockStudyContent() {}

    static List<String> passages(String... sources) {
        var result = new LinkedHashSet<String>();
        for (String source : sources) {
            if (source == null || source.isBlank()) continue;
            for (String raw : source.split("\\R+")) {
                if (result.size() >= 50) break;
                String line = raw.strip()
                        .replaceAll("^#{1,6}\\s*", "")
                        .replaceAll("^(?:[-*+]\\s+|\\d+[.)]\\s+)", "")
                        .replaceAll("[*_`>]", "")
                        .strip();
                if (line.isBlank() || line.matches("-{3,}") || line.startsWith("<!--") || line.startsWith("---")) continue;
                if (line.matches("(?i)^(노트:|버전:|자료:|선택한 요점 정리.*|포함한 강의자료.*|PDF 페이지 \\d+|슬라이드 \\d+|HWP 구역 \\d+).*$")) continue;
                if (line.matches("(?i)^(course_?id|course_?name|created|id|type|semester|status|updated):.*$")) continue;
                if (line.matches("^(수업 내용|교수님 강조 내용|질문과 헷갈린 점|다음 수업까지 할 일)$")) continue;
                for (String sentence : line.split("(?<=[.!?。！？])\\s+")) {
                    String clean = sentence.strip();
                    if (clean.length() >= 3) result.add(clean.length() > 320 ? clean.substring(0, 320).stripTrailing() + "…" : clean);
                }
            }
        }
        return new ArrayList<>(result);
    }

    static String clip(String text, int maxLength) {
        if (text == null) return "";
        String clean = text.strip();
        return clean.length() > maxLength ? clean.substring(0, maxLength).stripTrailing() + "…" : clean;
    }
}
