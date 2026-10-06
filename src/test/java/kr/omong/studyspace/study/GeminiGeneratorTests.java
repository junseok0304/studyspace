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
        assertEquals("PROVIDER_MAX_TOKENS",assertThrows(GeminiGenerator.Failure.class,
                ()->generator.parse("{\"candidates\":[{\"finishReason\":\"MAX_TOKENS\"}]}","FLASHCARD")).code);
        for(String body:new String[]{"{}","{\"candidates\":[{\"finishReason\":\"STOP\"}]}","not json"})
            assertThrows(GeminiGenerator.Failure.class,()->generator.parse(body,"SUMMARY"));
    }
    @Test void validatesMindMapBeforeSaving() {
        String valid="{\"label\":\"개념\",\"children\":[]}";
        assertEquals(valid,generator.parse(response(valid),"MIND_MAP").text());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parse(response("{\"label\":\"개념\"}"),"MIND_MAP"));
    }
    @Test void validatesVisualInfographicPagesAndTheirDiagramNodes() throws Exception {
        String infographic="""
                {"pages":[{"title":"사실에서 정보까지","subtitle":"표현과 해석의 흐름","relation":"사실 → 데이터 → 정보","layout":"flow","nodes":[
                  {"label":"사실","detail":"관찰하거나 기록할 수 있는 객관적인 사건과 값입니다."},
                  {"label":"데이터","detail":"사실을 문자나 숫자 같은 기호로 표현해 처리할 수 있게 만든 것입니다."}
                ]}]}
                """;
        assertEquals(infographic.strip(),generator.parse(response(infographic),"INFOGRAPHIC").text());
        var pageSchema=new ObjectMapper().valueToTree(GeminiGenerator.structuredSchema("INFOGRAPHIC")).path("properties").path("pages");
        assertEquals(6,pageSchema.path("maxItems").asInt());
        assertTrue(pageSchema.path("items").path("properties").path("layout").path("enum").toString().contains("group"));
        assertFalse(pageSchema.path("items").path("properties").path("nodes").path("items").path("properties").has("icon"));
        String parallel=infographic.replace("\"flow\"","\"group\"");
        assertEquals(parallel.strip(),generator.parse(response(parallel),"INFOGRAPHIC").text());
        var page=new ObjectMapper().readTree(infographic).path("pages").path(0).toString();
        assertEquals(6,new ObjectMapper().readTree(generator.parse(response("{\"pages\":["+String.join(",",java.util.Collections.nCopies(6,page))+"]}"),"INFOGRAPHIC").text()).path("pages").size());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parse(response("{\"pages\":["+String.join(",",java.util.Collections.nCopies(7,page))+"]}"),"INFOGRAPHIC"));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parse(response("{\"pages\":[{\"title\":\"비어 있음\",\"subtitle\":\"\",\"relation\":\"\",\"layout\":\"flow\",\"nodes\":[]}] }"),"INFOGRAPHIC"));
    }
    @Test void validatesStructuredQuizAndFlashcardResults() {
        String quiz="[{\"prompt\":\"프로세스란?\",\"options\":[\"실행 중인 프로그램\",\"파일\",\"장치\",\"문서\"],\"correctIndex\":0,\"hint\":\"프로그램과 실행 상태의 차이를 생각해 보세요.\",\"explanation\":\"실행 중인 프로그램입니다.\",\"source\":\"노트 1\"}]";
        var questions=generator.parseQuiz(quiz,1);
        assertEquals("프로그램과 실행 상태의 차이를 생각해 보세요.",questions.getFirst().hint());
        assertEquals("프로세스란?",questions.getFirst().prompt());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(quiz,2));
        String cards="[{\"type\":\"DEFINITION\",\"front\":\"TCP란?\",\"back\":\"연결 지향 프로토콜\",\"explanation\":\"신뢰성 있는 전송을 제공합니다.\",\"source\":\"노트 1\"}]";
        assertEquals("TCP란?",generator.parseFlashcards(cards,1).getFirst().front());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(cards.replace("노트 1",""),1));
    }
    @Test void schemaRequiresQuizHintsAndIntegerAnswers() {
        var schema=GeminiGenerator.structuredSchema("QUIZ");
        String encoded=new ObjectMapper().writeValueAsString(schema);
        assertTrue(encoded.contains("\"hint\""));
        assertTrue(encoded.contains("\"integer\""));
        assertTrue(encoded.contains("\"additionalProperties\":false"));
        assertTrue(new ObjectMapper().writeValueAsString(GeminiGenerator.structuredSchema("FLASHCARD")).contains("\"type\""));
        var cardSchema=GeminiGenerator.structuredSchema("FLASHCARD");
        assertEquals(1200,new ObjectMapper().valueToTree(cardSchema).path("items").path("properties").path("back").path("maxLength").asInt());
        assertEquals(700,new ObjectMapper().valueToTree(cardSchema).path("items").path("properties").path("explanation").path("maxLength").asInt());
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz("""
            [{"prompt":"질문","options":["가","나","다","라"],"correctIndex":0.5,"hint":"힌트","explanation":"설명","source":"노트"}]
            """,1));
    }

    @Test void rejectsPositionalOrRepeatedStudyQuestions() {
        String template="[{\"prompt\":\"%s\",\"options\":[\"실행 중인 프로그램\",\"파일\",\"장치\",\"문서\"],\"correctIndex\":0,\"hint\":\"실행 상태를 떠올려 보세요.\",\"explanation\":\"프로세스는 실행 중인 프로그램입니다.\",\"source\":\"강의노트\"}]";
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(template.formatted("원문에서 2번째 핵심 문장은 무엇인가요?"),1));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(template.formatted("보기 중 2번은 무엇인가요?"),1));
        String duplicate=template.formatted("프로세스란?").replaceFirst("\\]$", ","+template.formatted("프로세스란 !").substring(1));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(duplicate,2));
        String repeatedOptions=template.formatted("프로세스란?").replace("\"파일\"","\"실행 중인 프로그램!\"");
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseQuiz(repeatedOptions,1));
    }

    @Test void rejectsFlashcardsThatRevealTheirAnswerOrRepeatTheQuestion() {
        String template="[{\"type\":\"DEFINITION\",\"front\":\"%s\",\"back\":\"프로세스는 실행 중인 프로그램입니다.\",\"explanation\":\"실행 상태가 핵심입니다.\",\"source\":\"강의노트\"}]";
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(template.formatted("‘프로세스는 실행 중인 프로그램입니다.’의 핵심은?"),1));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(template.formatted("원문의 3번째 문장은 무엇인가요?"),1));
        String duplicate=template.formatted("프로세스란?").replaceFirst("\\]$", ","+template.formatted("프로세스란 !").substring(1));
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(duplicate,2));
        String repeatedAnswer="[{\"type\":\"DEFINITION\",\"front\":\"프로세스란?\",\"back\":\"실행 중인 프로그램\",\"explanation\":\"실행 상태를 뜻합니다.\",\"source\":\"강의노트\"},{\"type\":\"MECHANISM\",\"front\":\"프로세스의 역할은?\",\"back\":\"실행 중인 프로그램\",\"explanation\":\"프로그램 실행 상태와 관련됩니다.\",\"source\":\"강의노트\"}]";
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(repeatedAnswer,2));
        String answerInFront="[{\"type\":\"DEFINITION\",\"front\":\"프로세스는 실행 중인 프로그램입니다.의 의미는?\",\"back\":\"프로세스는 실행 중인 프로그램입니다.\",\"explanation\":\"실행 상태를 뜻합니다.\",\"source\":\"강의노트\"}]";
        assertThrows(GeminiGenerator.Failure.class,()->generator.parseFlashcards(answerInFront,1));
    }

    @Test void providerErrorsHaveActionableMessagesWithoutSecrets() {
        assertTrue(new GeminiGenerator.Failure("PROVIDER_NOT_CONFIGURED").userMessage().contains("키"));
        assertTrue(new GeminiGenerator.Failure("PROVIDER_RATE_LIMITED").userMessage().contains("한도"));
        assertTrue(new GeminiGenerator.Failure("PROVIDER_MODEL_NOT_FOUND").userMessage().contains("모델"));
    }
    String response(String content) { return new ObjectMapper().writeValueAsString(java.util.Map.of("candidates",java.util.List.of(java.util.Map.of("finishReason","STOP","content",java.util.Map.of("parts",java.util.List.of(java.util.Map.of("text",content))))))); }
}
