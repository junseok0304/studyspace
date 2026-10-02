package kr.omong.studyspace.study;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MockStudyContentTests {
    @Test
    void extractsActualMarkdownContentAndSkipsEmptyTemplateAndMetadata() {
        List<String> passages = MockStudyContent.passages("""
                ## 수업 내용
                - HTTP 요청은 클라이언트가 서버에 정보를 전달하는 과정이다.
                ## 다음 수업까지 할 일
                ---
                course_id: sample-course
                ## PDF 페이지 1
                브라우저는 요청을 보내고 서버의 응답을 받는다.
                """);

        assertEquals(2, passages.size(), passages.toString());
        assertTrue(passages.get(0).contains("HTTP 요청은 클라이언트"));
        assertTrue(passages.get(1).contains("브라우저는 요청을 보내고"));
    }

    @Test
    void hidesAiOnlyMetadataAndPreviewScaffoldingFromMockStudySources() {
        List<String> passages = MockStudyContent.passages("""
                <!-- AI 전용 메타데이터 · 읽기 화면에는 표시되지 않음
                ---
                course_id: \"sample-course\"
                id: \"lecture-sample\"
                ---
                -->
                ## 원문 미리보기
                ## 실제 생성 전 확인
                실제 수업에서는 표준 출력 스트림을 다룹니다.
                """);

        assertEquals(List.of("실제 수업에서는 표준 출력 스트림을 다룹니다."), passages);
    }

    @Test
    void excludesTheNoteTitleFromMockLearningContent() {
        List<String> passages = MockStudyContent.passagesExcluding("0902 2차시", "# 0902 2차시\n\n## 수업 내용\n\ncout은 표준 출력 스트림 객체다.");
        assertEquals(List.of("cout은 표준 출력 스트림 객체다."), passages);
    }

    @Test
    void choosesDistinctFactsAndQuestionTypesForADeck() {
        List<MockStudyContent.CardCandidate> candidates = MockStudyContent.cardCandidates("""
                ## HTTP 요청
                클라이언트는 서버에 요청을 보내고 서버는 응답을 반환한다.
                ## 처리 과정
                먼저 요청을 검증하고 다음 단계에서 결과를 생성한다.
                """);

        List<MockStudyContent.CardCandidate> selected = MockStudyContent.chooseCardCandidates(candidates, 4);
        assertEquals(4, selected.size());
        assertEquals(4, selected.stream().map(MockStudyContent.CardCandidate::statement).collect(java.util.stream.Collectors.toSet()).size());
        assertTrue(selected.stream().map(MockStudyContent.CardCandidate::type).distinct().count() >= 2);
    }

    @Test
    void buildsInfographicPagesWithMeaningfulRelationships() {
        List<MockStudyContent.InfographicPage> pages = MockStudyContent.infographicPages("HTTP 흐름", """
                ## 요청
                클라이언트가 서버에 요청을 보낸다.
                ## 응답
                서버는 처리 결과를 응답으로 반환한다.
                """);

        assertTrue(!pages.isEmpty());
        assertTrue(pages.stream().allMatch(page -> !page.subtitle().isBlank() && !page.relation().isBlank()));
        assertTrue(pages.stream().flatMap(page -> page.nodes().stream()).allMatch(node -> !node.label().isBlank() && !node.detail().isBlank()));
    }
}
