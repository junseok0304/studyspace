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
}
