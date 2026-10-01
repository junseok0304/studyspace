package kr.omong.studyspace.study;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Extracts readable source passages for development-mode study previews. */
final class MockStudyContent {
    private static final Pattern SUBJECT = Pattern.compile("^(.{1,40}?)(?:은|는|이|가|란|을|를|의)\\s*");
    private MockStudyContent() {}

    static List<String> passages(String... sources) {
        var result = new LinkedHashSet<String>();
        for (String source : sources) {
            if (source == null || source.isBlank()) continue;
            String visibleSource = source.replaceAll("(?s)<!--\\s*AI 전용 메타데이터.*?-->", "");
            for (String raw : visibleSource.split("\\R+")) {
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
                if (line.matches("^(원문 미리보기|원문 내용의 흐름|실제 생성 전 확인|핵심 개념 · 내용|개발용 미리보기입니다.*)$")) continue;
                for (String sentence : line.split("(?<=[.!?。！？])\\s+")) {
                    String clean = sentence.strip();
                    if (clean.length() >= 3) result.add(clean.length() > 320 ? clean.substring(0, 320).stripTrailing() + "…" : clean);
                }
            }
        }
        return new ArrayList<>(result);
    }

    static List<String> passagesExcluding(String excludedText, String... sources) {
        String excluded = excludedText == null ? "" : excludedText.strip();
        return passages(sources).stream().filter(value -> !value.equals(excluded)).toList();
    }

    /**
     * Splits long source lines at natural connectors so a short mock source does not
     * produce the same answer for every requested card.
     */
    static List<String> cardPassages(String... sources) {
        var result = new LinkedHashSet<String>();
        for (String passage : passages(sources)) {
            if (passage == null || passage.isBlank()) continue;
            String[] fragments = passage.split("(?<=[,;:：])\\s+|\\s+(?=(?:그리고|또한|반면|따라서|즉|하지만)\\s+)");
            for (String fragment : fragments) {
                String clean = fragment.strip();
                if (clean.length() >= 12) result.add(clean);
            }
            result.add(passage);
        }
        return new ArrayList<>(result);
    }

    /** Returns a compact concept label for mock questions without copying the answer. */
    static String subject(String passage) {
        String clean = passage == null ? "" : passage.replaceAll("^[‘’'\" ]+|[.。!?！？]+$", "").strip();
        Matcher matcher = SUBJECT.matcher(clean);
        if (matcher.find()) return clip(matcher.group(1), 36).strip();
        int boundary = clean.indexOf(',');
        if (boundary < 0) boundary = clean.indexOf(' ');
        if (boundary > 0) return clip(clean.substring(0, boundary), 36).strip();
        return clip(clean, 24);
    }

    static String clip(String text, int maxLength) {
        if (text == null) return "";
        String clean = text.strip();
        return clean.length() > maxLength ? clean.substring(0, maxLength).stripTrailing() + "…" : clean;
    }
}
