package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class GenerationTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;

    @Test void mockVisualizationContainsSourceNoteConcepts() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('map-preview@example.com','test','지도 미리보기')");
        long ownerId=db.queryForObject("select id from users where email='map-preview@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('map-preview-course',?,'2026-2','웹 기초')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('map-preview-note','map-preview-course',?,'HTTP 흐름','## 요청\n클라이언트가 서버에 HTTP 요청을 보냅니다.\n## 응답\n서버는 처리 결과를 HTTP 응답으로 돌려줍니다.',1)",ownerId);
        var owner=user(Long.toString(ownerId));
        mvc.perform(post("/api/notes/map-preview-note/generations").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"MIND_MAP\",\"requestId\":\"5e777dd9-aa0b-4b04-951a-b3c386e2cf08\",\"attachmentIds\":[]}"))
                .andExpect(status().isAccepted());
        for(int i=0;i<100 && !"COMPLETED".equals(db.queryForObject("select status from generation_jobs where user_id=?",String.class,ownerId));i++) Thread.sleep(10);
        mvc.perform(get("/api/notes/map-preview-note/generations").with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].kind").value("MIND_MAP"))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.containsString("클라이언트가 서버에 HTTP 요청을 보냅니다.")))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.containsString("서버는 처리 결과를 HTTP 응답으로 돌려줍니다.")));
    }

    @Test void mockGenerationIsQueuedStoredIdempotentAndOwnerOnly() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('generation@example.com','test','학생')");
        long ownerId=db.queryForObject("select id from users where email='generation@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('generation-course',?,'2026-2','운영체제')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('generation-note','generation-course',?,'프로세스','# 프로세스와 스레드',3)",ownerId);
        db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256,analysis_status,extracted_text,analyzed_at) values('generation-file','generation-note',?,'강의자료.pdf','test/file.pdf','application/pdf','pdf',100,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','TEXT_READY','페이지 교체 알고리즘 FIFO',current_timestamp)",ownerId);
        var owner=user(Long.toString(ownerId));
        String input="{\"kind\":\"SUMMARY\",\"requestId\":\"7d777dd9-aa0b-4b04-951a-b3c386e2cf08\",\"attachmentIds\":[\"generation-file\"]}";
        for(int i=0;i<2;i++) mvc.perform(post("/api/notes/generation-note/generations").with(owner).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(input))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.sourceNoteVersion").value(3))
                .andExpect(jsonPath("$.attachmentCount").value(1))
                .andExpect(jsonPath("$.mockResult").value(true));
        assertEquals(1,db.queryForObject("select count(*) from generation_jobs where user_id=?",Integer.class,ownerId));
        assertEquals("페이지 교체 알고리즘 FIFO",db.queryForObject("select extracted_text from generation_job_sources where source_id='generation-file'",String.class));
        for(int i=0;i<100 && !"COMPLETED".equals(db.queryForObject("select status from generation_jobs where user_id=?",String.class,ownerId));i++) Thread.sleep(10);
        mvc.perform(get("/api/notes/generation-note/generations").with(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("COMPLETED"))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.containsString("## 요약")))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("실제 생성 전 확인"))))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("Gemini API를 호출하지 않았습니다"))))
                .andExpect(jsonPath("$[0].content").value(org.hamcrest.Matchers.containsString("페이지 교체 알고리즘 FIFO")));
        String generationJob=db.queryForObject("select id from generation_jobs where user_id=? and request_id=?",String.class,ownerId,"7d777dd9-aa0b-4b04-951a-b3c386e2cf08");
        db.update("update generation_job_sources set extracted_text=? where job_id=?","## PDF 페이지 4\n페이지 교체 알고리즘 FIFO",generationJob);
        mvc.perform(get("/api/generations/"+generationJob+"/sources").with(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.noteVersion").value(3))
                .andExpect(jsonPath("$.attachments[0].id").value("generation-file"))
                .andExpect(jsonPath("$.attachments[0].available").value(true))
                .andExpect(jsonPath("$.attachments[0].name").value("강의자료.pdf"))
                .andExpect(jsonPath("$.attachments[0].locations[0]").value("PDF 페이지 4"));
        mvc.perform(get("/api/generations/"+generationJob+"/sources").with(user("999999"))).andExpect(status().isNotFound());
        String artifactId=db.queryForObject("select id from learning_artifacts where job_id=?",String.class,generationJob);
        mvc.perform(get("/api/courses/generation-course/review-sources").with(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(artifactId)).andExpect(jsonPath("$[0].kind").value("SUMMARY"));
        mvc.perform(post("/api/notes/generation-note/quiz-sets").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"requestId\":\"6d777dd9-aa0b-4b04-951a-b3c386e2cf08\",\"questionCount\":3,\"artifactId\":\""+artifactId+"\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.sourceArtifactId").value(artifactId));
        String update="{\"title\":\"내 복습 요약\",\"content\":\"# 직접 고친 내용\",\"version\":0}";
        mvc.perform(put("/api/artifacts/"+artifactId).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("내 복습 요약"))
                .andExpect(jsonPath("$.content").value("# 직접 고친 내용")).andExpect(jsonPath("$.artifactVersion").value(1));
        mvc.perform(put("/api/artifacts/"+artifactId).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update))
                .andExpect(status().isConflict());
        mvc.perform(put("/api/artifacts/"+artifactId).with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/notes/generation-note/generations").with(user("999999"))).andExpect(status().isNotFound());
        mvc.perform(post("/api/notes/generation-note/generations").with(owner).contentType(MediaType.APPLICATION_JSON).content(input)).andExpect(status().isForbidden());
        db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,model,mock_result) values('cancel-job','9e0d00b6-5038-43f3-bda5-cd436f92703f',?,'generation-note','SUMMARY','PENDING',3,'gemini-2.5-flash',true)",ownerId);
        mvc.perform(delete("/api/generations/cancel-job").with(owner).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.canceled").value(true)).andExpect(jsonPath("$.status").value("CANCELED"));
        mvc.perform(delete("/api/generations/cancel-job").with(owner).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.canceled").value(false));
        mvc.perform(delete("/api/generations/cancel-job").with(user("999999")).with(csrf())).andExpect(status().isNotFound());
        String retry="{\"requestId\":\"54d26085-1232-4202-80bc-b44d0ee343a8\"}";
        mvc.perform(post("/api/generations/cancel-job/retry").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(retry))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.sourceNoteVersion").value(3)).andExpect(jsonPath("$.attachmentCount").value(0));
        mvc.perform(post("/api/generations/cancel-job/retry").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(retry))
                .andExpect(status().isAccepted());
        assertEquals(1,db.queryForObject("select count(*) from generation_jobs where request_id='54d26085-1232-4202-80bc-b44d0ee343a8'",Integer.class));
        mvc.perform(post("/api/generations/cancel-job/retry").with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(retry)).andExpect(status().isNotFound());
        db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,model,mock_result) values('map-job','84e20d5e-47e8-4c89-9fcb-23013a73a5cb',?,'generation-note','MIND_MAP','COMPLETED',3,'gemini-2.5-flash',true)",ownerId);
        db.update("insert into learning_artifacts(id,job_id,user_id,note_id,kind,title,content,source_note_version,model,mock_result) values('map-artifact','map-job',?,'generation-note','MIND_MAP','지도','{\"label\":\"운영체제\",\"children\":[]}',3,'gemini-2.5-flash',true)",ownerId);
        mvc.perform(put("/api/artifacts/map-artifact").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"지도\",\"content\":\"{\\\"children\\\":[]}\",\"version\":0}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/artifacts/map-artifact").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"수정 지도\",\"content\":\"{\\\"label\\\":\\\"운영체제\\\",\\\"children\\\":[{\\\"label\\\":\\\"프로세스\\\"}]}\",\"version\":0}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.artifactVersion").value(1));
        String regenerate="{\"kind\":\"SUMMARY\",\"requestId\":\"1d777dd9-aa0b-4b04-951a-b3c386e2cf08\",\"regenerateFromJobId\":\""+generationJob+"\"}";
        mvc.perform(post("/api/notes/generation-note/generations").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(regenerate))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.regenerateFromJobId").value(generationJob));
        mvc.perform(post("/api/notes/generation-note/generations").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(regenerate))
                .andExpect(status().isAccepted());
        assertEquals(1,db.queryForObject("select count(*) from generation_jobs where request_id='1d777dd9-aa0b-4b04-951a-b3c386e2cf08'",Integer.class));
    }

    @Test void allowsThreeConcurrentGenerationsPerUserAndRejectsTheFourth() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('limits@example.com','test','한도')");
        long ownerId=db.queryForObject("select id from users where email='limits@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('limits-course',?,'2026-2','한도과목')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('limits-note','limits-course',?,'한도노트','# 내용',0)",ownerId);
        var owner=user(Long.toString(ownerId));
        String input="{\"kind\":\"SUMMARY\",\"requestId\":\"8e777dd9-aa0b-4b04-951a-b3c386e2cf08\",\"attachmentIds\":[]}";
        for(int i=0;i<2;i++) db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,model,mock_result) values(?,?,?,'limits-note','SUMMARY','PENDING',0,'gemini-3.6-flash',true)",
                "limit-job-"+i,"limit-request-"+i,ownerId);
        mvc.perform(post("/api/notes/limits-note/generations").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input))
                .andExpect(status().isAccepted());
        for(int i=2;i<5;i++) db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,model,mock_result) values(?,?,?,'limits-note','SUMMARY','PENDING',0,'gemini-3.6-flash',true)",
                "limit-job-"+i,"limit-request-"+i,ownerId);
        String fourth="{\"kind\":\"SUMMARY\",\"requestId\":\"b5c3a9a1-0c83-4f95-bb60-b72ee5d42e9f\",\"attachmentIds\":[]}";
        mvc.perform(post("/api/notes/limits-note/generations").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(fourth))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("동시에 최대 3건까지 생성할 수 있습니다. 진행 중인 작업이 완료되면 다시 시도해 주세요."));
    }
}
