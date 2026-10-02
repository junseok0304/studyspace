package kr.omong.studyspace.study;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Extracts readable source passages for development-mode study previews. */
final class MockStudyContent {
    private static final Pattern HEADING = Pattern.compile("^#{1,6}\\s*(.+?)\\s*$");
    private static final Pattern SUBJECT = Pattern.compile("^(.{1,40}?)(?:은|는|이|가|란|을|를|의)\\s*");
    private static final Pattern LOCATION = Pattern.compile("(?i)^(?:PDF 페이지|슬라이드|HWP 구역)\\s*\\d+.*$");

    private MockStudyContent() {}

    /** A passage retains its nearest meaningful markdown heading for better recall prompts. */
    record StudyPassage(String heading, String text) {}

    /** A candidate contains one answerable fact and the concept it tests. */
    record CardCandidate(String topic, String statement, String type, String heading) {}

    record InfographicNode(String label, String detail) {}
    record InfographicPage(String title, String subtitle, String relation, String layout,
                           List<InfographicNode> nodes) {}

    static List<String> passages(String... sources) {
        return studyPassages(sources).stream().map(StudyPassage::text).toList();
    }

    static List<StudyPassage> studyPassages(String... sources) {
        Map<String, StudyPassage> result = new LinkedHashMap<>();
        for (String source : sources) {
            if (source == null || source.isBlank()) continue;
            String visibleSource = source.replaceAll("(?s)<!--\\s*AI 전용 메타데이터.*?-->", "");
            String section = "";
            boolean sectionHasContent = false;
            for (String raw : visibleSource.split("\\R+")) {
                String original = raw.strip();
                if (original.isBlank() || original.matches("-{3,}")) continue;
                Matcher heading = HEADING.matcher(original);
                if (heading.matches()) {
                    if (!section.isBlank() && !sectionHasContent) addPassage(result, section, section);
                    String headingText = cleanHeading(heading.group(1));
                    section = ignoredHeading(headingText) || LOCATION.matcher(headingText).matches() ? "" : headingText;
                    sectionHasContent = false;
                    continue;
                }
                String line = cleanLine(original);
                if (ignoredLine(line)) continue;
                for (String sentence : splitSentences(line)) {
                    String clean = sentence.strip();
                    if (clean.length() < 3) continue;
                    if (clean.length() > 320) clean = clean.substring(0, 320).stripTrailing() + "…";
                    String key = normalize(clean);
                    if (!key.isBlank()) {
                        result.putIfAbsent(key, new StudyPassage(section, clean));
                        sectionHasContent = true;
                    }
                    if (result.size() >= 80) break;
                }
                if (result.size() >= 80) break;
            }
            if (result.size() < 80 && !section.isBlank() && !sectionHasContent) addPassage(result, section, section);
        }
        return new ArrayList<>(result.values());
    }

    private static void addPassage(Map<String, StudyPassage> result, String heading, String text) {
        String key = normalize(text);
        if (!key.isBlank()) result.putIfAbsent(key, new StudyPassage(heading, text));
    }

    static List<String> passagesExcluding(String excludedText, String... sources) {
        String excluded = excludedText == null ? "" : excludedText.strip();
        return passages(sources).stream().filter(value -> !value.equals(excluded)).toList();
    }

    /**
     * Builds distinct, answerable facts. Full source sentences are preferred; short
     * lexical phrases are added only when the requested deck needs more coverage.
     */
    static List<CardCandidate> cardCandidates(String... sources) {
        List<StudyPassage> passages = studyPassages(sources);
        Map<String, CardCandidate> result = new LinkedHashMap<>();
        for (StudyPassage passage : passages) addCandidate(result, passage, passage.text());
        for (StudyPassage passage : passages) {
            for (String fragment : splitClauses(passage.text())) addCandidate(result, passage, fragment);
            for (String phrase : lexicalPhrases(passage.text())) addCandidate(result, passage, phrase);
        }
        return new ArrayList<>(result.values());
    }

    static List<CardCandidate> chooseCardCandidates(List<CardCandidate> candidates, int requested) {
        if (requested <= 0 || candidates.isEmpty()) return List.of();
        List<CardCandidate> available = new ArrayList<>(candidates);
        List<CardCandidate> selected = new ArrayList<>();
        Set<String> statements = new HashSet<>();
        Set<String> topics = new HashSet<>();
        Set<String> types = new HashSet<>();
        while (selected.size() < requested && selected.size() < available.size()) {
            CardCandidate best = null;
            int bestScore = Integer.MIN_VALUE;
            for (CardCandidate candidate : available) {
                String statementKey = normalize(candidate.statement());
                if (!statements.add(statementKey)) continue;
                statements.remove(statementKey);
                int score = 0;
                if (!topics.contains(normalize(candidate.topic()))) score += 20;
                if (!types.contains(candidate.type())) score += 8;
                if (best == null || score > bestScore) { best = candidate; bestScore = score; }
            }
            if (best == null) break;
            selected.add(best);
            statements.add(normalize(best.statement()));
            topics.add(normalize(best.topic()));
            types.add(best.type());
            available.remove(best);
        }
        return selected;
    }

    static List<InfographicPage> infographicPages(String title, String... sources) {
        List<StudyPassage> passages = studyPassages(sources);
        if (passages.isEmpty()) {
            return List.of(new InfographicPage(cleanTitle(title), "원문에서 확인할 핵심 내용을 정리합니다.",
                    "노트의 핵심 주제를 하나의 개념으로 확인합니다.", "group",
                    List.of(new InfographicNode(cleanTitle(title), "원문에 기록된 내용을 다시 확인해 보세요."))));
        }
        List<StudyPassage> sampled = representativePassages(passages, 24);
        List<InfographicPage> pages = new ArrayList<>();
        for (int page = 0; page < sampled.size(); page += 4) {
            List<StudyPassage> group = sampled.subList(page, Math.min(sampled.size(), page + 4));
            List<InfographicNode> nodes = new ArrayList<>();
            Set<String> labels = new HashSet<>();
            for (StudyPassage passage : group) {
                String label = uniqueLabel(subject(passage.text()), passage.text(), labels);
                nodes.add(new InfographicNode(label, clip(passage.text(), 180)));
            }
            String pageTitle = pageTitle(title, group, page / 4);
            String layout = layoutFor(group);
            String relation = relationFor(layout, nodes);
            String subtitle = subtitleFor(pageTitle, nodes, layout);
            pages.add(new InfographicPage(pageTitle, subtitle, relation, layout, List.copyOf(nodes)));
            if (pages.size() == 6) break;
        }
        return pages;
    }

    /** Splits long source lines at natural connectors for compatibility with older callers. */
    static List<String> cardPassages(String... sources) {
        return cardCandidates(sources).stream().map(CardCandidate::statement).toList();
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

    private static void addCandidate(Map<String, CardCandidate> result, StudyPassage passage, String statement) {
        if (statement == null) return;
        String clean = statement.replaceAll("\\s+", " ").strip();
        if (clean.length() < 3) return;
        String topic = subject(clean);
        if (topic.isBlank() || normalize(topic).length() < 2) topic = clip(passage.heading(), 40);
        if (topic.isBlank()) topic = subject(clean);
        String key = normalize(topic + "|" + clean);
        result.putIfAbsent(key, new CardCandidate(topic, clean, cardType(clean), passage.heading()));
    }

    private static List<String> splitSentences(String line) {
        return List.of(line.split("(?<=[.!?。！？])\\s+|(?<=다)\\s+(?=[가-힣A-Za-z])"));
    }

    private static List<String> splitClauses(String passage) {
        List<String> result = new ArrayList<>();
        for (String fragment : passage.split("(?<=[,;:：])\\s+|\\s+(?=(?:그리고|또한|반면|따라서|즉|하지만)\\s+)")) {
            String clean = fragment.strip();
            if (clean.length() >= 8 && !clean.equals(passage)) result.add(clean);
        }
        return result;
    }

    private static List<String> lexicalPhrases(String passage) {
        String[] words = passage.replaceAll("[,.!?。！？:：;()\\[\\]]", " ").trim().split("\\s+");
        if (words.length < 3 || words.length > 14) return List.of();
        List<String> result = new ArrayList<>();
        for (int index = 0; index + 1 < words.length; index++) {
            String phrase = words[index] + " " + words[index + 1];
            if (phrase.length() >= 4) result.add(phrase);
        }
        return result;
    }

    private static String cardType(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.matches(".*(반면|차이|비교|구분|대조).*")) return "COMPARISON";
        if (lower.matches(".*(때문|원인|결과|따라서|영향|유발).*")) return "CAUSE_EFFECT";
        if (lower.matches(".*(과정|단계|순서|먼저|다음|절차).*")) return "PROCESS";
        if (lower.matches(".*(방법|사용|적용|상황|경우|조건).*")) return "APPLICATION";
        if (lower.matches(".*(작동|동작|흐름|구성|수행|처리).*")) return "MECHANISM";
        return "DEFINITION";
    }

    private static List<StudyPassage> representativePassages(List<StudyPassage> passages, int limit) {
        if (passages.size() <= limit) return passages;
        List<StudyPassage> result = new ArrayList<>(limit);
        for (int index = 0; index < limit; index++) {
            result.add(passages.get(index * (passages.size() - 1) / (limit - 1)));
        }
        return result;
    }

    private static String layoutFor(List<StudyPassage> group) {
        String text = group.stream().map(StudyPassage::text).reduce("", (left, right) -> left + " " + right);
        if (text.matches("(?s).*(반면|차이|비교|구분|대조).*")) return "compare";
        if (text.matches("(?s).*(순환|반복|주기).*")) return "cycle";
        if (text.matches("(?s).*(중심|하위|구성요소|구성 요소).*")) return "hub";
        if (text.matches("(?s).*(과정|단계|순서|먼저|다음|절차|이후).*")) return "flow";
        return "group";
    }

    private static String relationFor(String layout, List<InfographicNode> nodes) {
        return switch (layout) {
            case "compare" -> "서로 다른 기준을 나란히 비교합니다.";
            case "cycle" -> "각 단계가 반복되며 다음 단계로 이어집니다.";
            case "hub" -> "중심 개념과 주요 구성 요소의 관계입니다.";
            case "flow" -> "앞의 개념이 다음 단계의 이해를 돕습니다.";
            default -> nodes.size() > 1 ? "서로 다른 핵심 주제를 같은 페이지에서 확인합니다." : "이 페이지의 핵심 개념을 확인합니다.";
        };
    }

    private static String subtitleFor(String title, List<InfographicNode> nodes, String layout) {
        String first = nodes.getFirst().label();
        return switch (layout) {
            case "compare" -> title + "에서 함께 비교할 기준을 정리했습니다.";
            case "flow" -> first + "에서 출발해 다음 개념으로 이어지는 흐름입니다.";
            case "hub" -> title + "의 중심 개념과 구성 요소를 정리했습니다.";
            case "cycle" -> title + "의 반복 구조와 각 단계를 정리했습니다.";
            default -> title + "에서 다룬 핵심 주제를 각각 정리했습니다.";
        };
    }

    private static String pageTitle(String title, List<StudyPassage> group, int page) {
        String heading = group.stream().map(StudyPassage::heading).filter(value -> value != null && !value.isBlank()).findFirst().orElse("");
        if (!heading.isBlank()) return clip(heading, 48);
        return page == 0 ? cleanTitle(title) : clip(subject(group.getFirst().text()), 48);
    }

    private static String uniqueLabel(String preferred, String detail, Set<String> used) {
        String base = preferred == null || preferred.isBlank() ? subject(detail) : preferred;
        base = clip(base, 30);
        String label = base;
        int suffix = 2;
        while (!used.add(normalize(label))) label = clip(base, 25) + " " + suffix++;
        return label;
    }

    private static String cleanTitle(String title) {
        return clip(title == null || title.isBlank() ? "학습 내용" : title.strip(), 48);
    }

    private static String cleanHeading(String value) {
        return value.replaceAll("[*_`>]", "").strip();
    }

    private static String cleanLine(String raw) {
        return raw.replaceAll("^(?:[-*+]\\s+|\\d+[.)]\\s+)", "")
                .replaceAll("[*_`>]", "").strip();
    }

    private static boolean ignoredHeading(String heading) {
        return heading.matches("^(수업 내용|교수님 강조 내용|질문과 헷갈린 점|다음 수업까지 할 일)$")
                || heading.matches("^(원문 미리보기|원문 내용의 흐름|실제 생성 전 확인|핵심 개념 · 내용|개발용 미리보기입니다.*)$");
    }

    private static boolean ignoredLine(String line) {
        if (line.isBlank() || line.matches("-{3,}") || line.startsWith("<!--") || line.startsWith("---")) return true;
        if (LOCATION.matcher(line).matches()) return true;
        if (line.matches("(?i)^(노트:|버전:|자료:|선택한 요점 정리.*|포함한 강의자료.*).*$")) return true;
        return line.matches("(?i)^(course_?id|course_?name|created|id|type|semester|status|updated):.*$");
    }

    private static String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]", "");
    }
}
