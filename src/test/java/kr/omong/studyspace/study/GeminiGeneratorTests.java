package kr.omong.studyspace.study;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

class GeminiGeneratorTests {
    final GeminiGenerator generator=new GeminiGenerator("",new ObjectMapper());
    @Test void refusesUnconfiguredProviderWithoutNetwork() {
        assertEquals("PROVIDER_NOT_CONFIGURED",assertThrows(GeminiGenerator.Failure.class,()->generator.generate("gemini-2.5-flash","SUMMARY","노트")).code);
    }
    @Test void refusesUnconfiguredImageProviderWithoutNetwork() {
        assertEquals("PROVIDER_NOT_CONFIGURED",assertThrows(GeminiGenerator.Failure.class,
                () -> generator.analyzeImage("gemini-2.5-flash","image/png",new byte[]{(byte)0x89,'P','N','G'})).code);
    }
    @Test void excludesThoughtsAndCombinesAnswerParts() {
        assertEquals("핵심 요약",generator.parse("""
            {"candidates":[{"finishReason":"STOP","content":{"parts":[{"thought":true,"text":"내부 추론"},{"text":"핵심 "},{"text":"요약"}]}}]}
            ""","SUMMARY").text());
    }
    @Test void rejectsTruncatedBlockedAndInvalidOutputs() {
        for(String body:new String[]{"{}","{\"candidates\":[{\"finishReason\":\"MAX_TOKENS\"}]}","{\"candidates\":[{\"finishReason\":\"STOP\"}]}","not json"})
            assertThrows(GeminiGenerator.Failure.class,()->generator.parse(body,"SUMMARY"));
    }
    @Test void validatesMindMapBeforeSaving() {
        String valid="{\"label\":\"개념\",\"children\":[]}";
        assertEquals(valid,generator.parse(response(valid),"MIND_MAP").text());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parse(response("{\"label\":\"개념\"}"),"MIND_MAP"));
    }
    @Test void validatesStructuredQuizAndFlashcardResults() {
        String quiz="[{\"prompt\":\"프로세스란?\",\"options\":[\"실행 중인 프로그램\",\"파일\",\"장치\",\"문서\"],\"correctIndex\":0,\"hint\":\"프로그램과 실행 상태의 차이를 생각해 보세요.\",\"explanation\":\"실행 중인 프로그램입니다.\",\"source\":\"노트 1\"}]";
        var questions=generator.parseQuiz(quiz,1);
        assertEquals("프로그램과 실행 상태의 차이를 생각해 보세요.",questions.getFirst().hint());
        assertEquals("프로세스란?",questions.getFirst().prompt());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(quiz,2));
        String cards="[{\"front\":\"TCP란?\",\"back\":\"연결 지향 프로토콜\",\"explanation\":\"신뢰성 있는 전송을 제공합니다.\",\"source\":\"노트 1\"}]";
        assertEquals("TCP란?",generator.parseFlashcards(cards,1).getFirst().front());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(cards.replace("노트 1",""),1));
    }
    @Test void schemaRequiresQuizHintsAndIntegerAnswers() {
        var schema=GeminiGenerator.structuredSchema("QUIZ");
        String encoded=new ObjectMapper().writeValueAsString(schema);
        assertTrue(encoded.contains("\"hint\""));
        assertTrue(encoded.contains("\"integer\""));
        assertTrue(encoded.contains("\"additionalProperties\":false"));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz("""
            [{"prompt":"질문","options":["가","나","다","라"],"correctIndex":0.5,"hint":"힌트","explanation":"설명","source":"노트"}]
            """,1));
    }

    @Test void providerErrorsHaveActionableMessagesWithoutSecrets() {
        assertTrue(new GeminiGenerator.Failure("PROVIDER_NOT_CONFIGURED").userMessage().contains("키"));
        assertTrue(new GeminiGenerator.Failure("PROVIDER_RATE_LIMITED").userMessage().contains("한도"));
        assertTrue(new GeminiGenerator.Failure("PROVIDER_MODEL_NOT_FOUND").userMessage().contains("모델"));
    }
    String response(String content) { return new ObjectMapper().writeValueAsString(java.util.Map.of("candidates",java.util.List.of(java.util.Map.of("finishReason","STOP","content",java.util.Map.of("parts",java.util.List.of(java.util.Map.of("text",content))))))); }
}
