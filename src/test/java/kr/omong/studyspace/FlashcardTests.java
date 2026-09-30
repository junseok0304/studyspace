package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc
class FlashcardTests {
    @Autowired MockMvc mvc; @Autowired JdbcTemplate db;
    @Test void createsDeckAndStoresIdempotentSelfReviews() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('cards@example.com','test','학생')");long userId=db.queryForObject("select id from users where email='cards@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('cards-course',?,'2026-2','네트워크')",userId);db.update("insert into notes(id,course_id,user_id,title,body,version) values('cards-note','cards-course',?,'TCP','연결 지향 흐름 제어 혼잡 제어',4)",userId);db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256,analysis_status,extracted_text,analyzed_at) values('cards-file','cards-note',?,'TCP.pdf','test/cards-file.pdf','application/pdf','pdf',100,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','TEXT_READY','TCP는 연결 지향 프로토콜입니다.',current_timestamp)",userId);var owner=user(Long.toString(userId));
        db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,model,mock_result) values('cards-job','66666666-6666-4666-8666-666666666666',?,'cards-note','SUMMARY','COMPLETED',4,'gemini-2.5-flash',true)",userId);
        db.update("insert into learning_artifacts(id,job_id,user_id,note_id,kind,title,content,source_note_version,model,mock_result) values('88888888-8888-4888-8888-888888888888','cards-job',?,'cards-note','SUMMARY','요점 정리 · TCP','TCP의 연결 설정은 SYN, SYN-ACK, ACK 순서로 진행됩니다.',4,'gemini-2.5-flash',true)",userId);
        String create="{\"requestId\":\"44444444-4444-4444-8444-444444444444\",\"cardCount\":5,\"attachmentIds\":[\"cards-file\"]}";for(int i=0;i<2;i++)mvc.perform(post("/api/notes/cards-note/flashcard-decks").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(create)).andExpect(status().isCreated()).andExpect(jsonPath("$.cardCount").value(5)).andExpect(jsonPath("$.cards[0].back").value(org.hamcrest.Matchers.containsString("연결 지향 흐름 제어 혼잡 제어"))).andExpect(jsonPath("$.cards[1].back").value(org.hamcrest.Matchers.containsString("TCP는 연결 지향 프로토콜입니다.")));
        mvc.perform(post("/api/notes/cards-note/flashcard-decks").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"requestId\":\"77777777-7777-4777-8777-777777777777\",\"cardCount\":3,\"artifactId\":\"88888888-8888-4888-8888-888888888888\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.cards[0].source").value(org.hamcrest.Matchers.containsString("요점 정리")));
        String deck=db.queryForObject("select id from flashcard_decks where user_id=? and request_id='44444444-4444-4444-8444-444444444444'",String.class,userId);String card=db.queryForObject("select id from flashcards where deck_id=? and card_order=0",String.class,deck);String review="{\"requestId\":\"55555555-5555-4555-8555-555555555555\",\"rating\":\"KNOWN\"}";
        for(int i=0;i<2;i++)mvc.perform(post("/api/flashcards/"+card+"/reviews").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(review)).andExpect(status().isOk()).andExpect(jsonPath("$.rating").value("KNOWN"));
        mvc.perform(get("/api/flashcard-decks/"+deck).with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$.cards[0].lastRating").value("KNOWN"));
        mvc.perform(patch("/api/flashcards/"+card).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"front\":\"수정 질문\",\"back\":\"수정 답변\",\"explanation\":\"수정 해설\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.cards[0].front").value("수정 질문"));
        mvc.perform(post("/api/flashcard-decks/"+deck+"/cards").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"front\":\"추가 질문\",\"back\":\"추가 답변\",\"explanation\":\"\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.cardCount").value(6));
        mvc.perform(delete("/api/flashcards/"+card).with(owner).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.cardCount").value(5));
        mvc.perform(patch("/api/flashcards/"+card).with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"front\":\"침범\",\"back\":\"침범\",\"explanation\":\"\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/flashcard-decks/"+deck).with(user("999999"))).andExpect(status().isNotFound());
    }

    @Test void appliesSpacedRepetitionSchedule() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('spaced@example.com','test','학생')");
        long userId=db.queryForObject("select id from users where email='spaced@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('spaced-course',?,'2026-2','운영체제')",userId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('spaced-note','spaced-course',?,'프로세스','# 프로세스\n\n프로세스 스레드 동기화',2)",userId);
        var owner=user(Long.toString(userId));
        mvc.perform(post("/api/notes/spaced-note/flashcard-decks").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"requestId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"cardCount\":3}")).andExpect(status().isCreated());
        String card=db.queryForObject("select id from flashcards where deck_id=(select id from flashcard_decks where user_id=?) order by card_order limit 1",String.class,userId);
        assertEquals("‘프로세스 스레드 동기화’의 핵심 내용을 설명해 보세요.",db.queryForObject("select front_text from flashcards where id=?",String.class,card));
        reviewCard(owner,card,"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","KNOWN"); assertState(card,1,1);
        reviewCard(owner,card,"cccccccc-cccc-4ccc-8ccc-cccccccccccc","KNOWN"); assertState(card,2,3);
        reviewCard(owner,card,"dddddddd-dddd-4ddd-8ddd-dddddddddddd","KNOWN"); assertState(card,3,7);
        reviewCard(owner,card,"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","AGAIN"); assertState(card,0,1);
    }

    private void reviewCard(RequestPostProcessor owner,String card,String requestId,String rating) throws Exception {
        mvc.perform(post("/api/flashcards/"+card+"/reviews").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"requestId\":\""+requestId+"\",\"rating\":\""+rating+"\"}")).andExpect(status().isOk());
    }
    private void assertState(String card,int repetition,int intervalDays) {
        var row=db.queryForMap("select repetition,interval_days from flashcards where id=?",card);
        assertEquals(repetition,((Number)row.get("repetition")).intValue());
        assertEquals(intervalDays,((Number)row.get("interval_days")).intValue());
    }
}
