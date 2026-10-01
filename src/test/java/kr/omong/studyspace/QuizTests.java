package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class QuizTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;

    @Test void quizAttemptsAreResumableIdempotentScoredAndWrongAnswersCanBeRetried() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('quiz@example.com','test','학생')");
        long userId=db.queryForObject("select id from users where email='quiz@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('quiz-course',?,'2026-2','자료구조')",userId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('quiz-note','quiz-course',?,'트리','# 트리\n\n트리는 계층 구조입니다.',2)",userId);
        db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256,analysis_status,extracted_text,analyzed_at) values('quiz-file','quiz-note',?,'트리.pdf','test/quiz-file.pdf','application/pdf','pdf',100,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','TEXT_READY','이진 탐색 트리는 정렬된 구조입니다.',current_timestamp)",userId);
        var owner=user(Long.toString(userId));
        String create="{\"requestId\":\"11111111-1111-4111-8111-111111111111\",\"questionCount\":3,\"attachmentIds\":[\"quiz-file\"]}";
        for(int i=0;i<2;i++) mvc.perform(post("/api/notes/quiz-note/quiz-sets").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(create))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.questionCount").value(3)).andExpect(jsonPath("$.title").value("퀴즈 · 트리"))
                .andExpect(jsonPath("$.sourceAttachmentIds[0]").value("quiz-file"));
        String setId=db.queryForObject("select id from quiz_sets where user_id=?",String.class,userId);
        org.junit.jupiter.api.Assertions.assertEquals("quiz-file",db.queryForObject("select source_attachment_ids from quiz_sets where id=?",String.class,setId));
        mvc.perform(get("/api/quiz-sets/"+setId+"/questions").with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].prompt").value(org.hamcrest.Matchers.containsString("1번째로 정리된 핵심 문장")))
                .andExpect(jsonPath("$[0].options").value(org.hamcrest.Matchers.hasItem("트리는 계층 구조입니다.")))
                .andExpect(jsonPath("$[0].options").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("트리"))))
                .andExpect(jsonPath("$[1].options").value(org.hamcrest.Matchers.hasItem("이진 탐색 트리는 정렬된 구조입니다.")))
                .andExpect(jsonPath("$[1].hint").value(org.hamcrest.Matchers.containsString("특징")))
                .andExpect(jsonPath("$[1].explanation").value(org.hamcrest.Matchers.containsString("이진 탐색 트리는 정렬된 구조입니다.")));
        String start="{\"requestId\":\"22222222-2222-4222-8222-222222222222\"}";
        mvc.perform(post("/api/quiz-sets/"+setId+"/attempts").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(start))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.questions[0].correctIndex").doesNotExist());
        String attemptId=db.queryForObject("select id from quiz_attempts where user_id=?",String.class,userId);
        String firstQuestion=db.queryForObject("select question_id from quiz_attempt_questions where attempt_id=? and question_order=0",String.class,attemptId);
        mvc.perform(put("/api/quiz-attempts/"+attemptId+"/answers/"+firstQuestion).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"selectedIndex\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.questions[0].selectedIndex").value(0)).andExpect(jsonPath("$.questions[0].correct").value(true))
                .andExpect(jsonPath("$.questions[0].correctIndex").value(0)).andExpect(jsonPath("$.questions[0].explanation").isNotEmpty());
        mvc.perform(put("/api/quiz-attempts/"+attemptId+"/answers/"+firstQuestion).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"selectedIndex\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.questions[0].correct").value(true));
        mvc.perform(put("/api/quiz-attempts/"+attemptId+"/answers/"+firstQuestion).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"selectedIndex\":1}"))
                .andExpect(status().isConflict());
        for(int i=0;i<2;i++) mvc.perform(post("/api/quiz-attempts/"+attemptId+"/submit").with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("COMPLETED")).andExpect(jsonPath("$.correctAnswers").value(1)).andExpect(jsonPath("$.questions[0].correctIndex").value(0));
        String wrong="{\"requestId\":\"33333333-3333-4333-8333-333333333333\",\"wrongFromAttemptId\":\""+attemptId+"\"}";
        mvc.perform(post("/api/quiz-sets/"+setId+"/attempts").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(wrong))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.mode").value("WRONG")).andExpect(jsonPath("$.totalQuestions").value(2));
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$.quizAttempts").value(1)).andExpect(jsonPath("$.quizAccuracy").value(33.3)).andExpect(jsonPath("$.wrongAnswers").value(2));
        mvc.perform(get("/api/courses/quiz-course/quiz-sets").with(owner)).andExpect(jsonPath("$[0].completedAttempts").value(1)).andExpect(jsonPath("$[0].bestAccuracy").value(33.3));
        mvc.perform(get("/api/quiz-sets/"+setId+"/attempts").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].questions[0].correctIndex").value(0));
        mvc.perform(get("/api/courses/quiz-course/quiz-sets").with(user("999999"))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/quiz-sets/"+setId).with(user("999999")).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(delete("/api/quiz-sets/"+setId).with(owner).with(csrf())).andExpect(status().isOk());
        mvc.perform(get("/api/quiz-sets/"+setId+"/attempts").with(owner)).andExpect(status().isNotFound());
    }

    @Test void ownerCanEditQuestionsOnlyBeforeAnAttemptStarts() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('quiz-editor@example.com','test','편집자')");
        long userId=db.queryForObject("select id from users where email='quiz-editor@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('quiz-edit-course',?,'2026-2','운영체제')",userId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('quiz-edit-note','quiz-edit-course',?,'프로세스','# 프로세스',1)",userId);
        var owner=user(Long.toString(userId));
        mvc.perform(post("/api/notes/quiz-edit-note/quiz-sets").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"requestId\":\"44444444-4444-4444-8444-444444444444\",\"questionCount\":3}"))
                .andExpect(status().isCreated());
        String setId=db.queryForObject("select id from quiz_sets where user_id=?",String.class,userId);
        String questionId=db.queryForObject("select id from quiz_questions where quiz_set_id=? and question_order=0",String.class,setId);
        String edit="{\"prompt\":\"프로세스의 정의는?\",\"options\":[\"실행 중인 프로그램\",\"파일\",\"컴파일러\",\"장치\"],\"correctIndex\":0,\"explanation\":\"프로세스는 실행 중인 프로그램입니다.\"}";
        mvc.perform(get("/api/quiz-sets/"+setId+"/questions").with(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].correctIndex").value(0));
        mvc.perform(put("/api/quiz-sets/"+setId+"/questions/"+questionId).with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/quiz-sets/"+setId+"/questions/"+questionId).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isOk()).andExpect(jsonPath("$.prompt").value("프로세스의 정의는?")).andExpect(jsonPath("$.options[0]").value("실행 중인 프로그램"));
        mvc.perform(post("/api/quiz-sets/"+setId+"/attempts").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"requestId\":\"55555555-5555-4555-8555-555555555555\"}"))
                .andExpect(status().isCreated());
        mvc.perform(put("/api/quiz-sets/"+setId+"/questions/"+questionId).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error").value("풀이를 시작한 퀴즈는 문항을 수정할 수 없습니다."));
    }
}
