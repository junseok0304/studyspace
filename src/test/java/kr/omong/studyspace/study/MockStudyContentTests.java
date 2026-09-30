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
}
