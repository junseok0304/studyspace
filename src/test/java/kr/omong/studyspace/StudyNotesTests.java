package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import tools.jackson.databind.ObjectMapper;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;

@SpringBootTest
@AutoConfigureMockMvc
class StudyNotesTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper json;
    @Test void notesPersistAndRejectForeignAccessAndStaleWrites() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('notes-owner@example.com','test','학생')");
        long id = db.queryForObject("select id from users where email='notes-owner@example.com'",Long.class);
        var owner = user(Long.toString(id));
        var result = mvc.perform(post("/api/courses").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"semester\":\"2026-2\",\"name\":\"자료구조\"}"))
                .andExpect(status().isCreated()).andReturn();
        String course = json.readTree(result.getResponse().getContentAsString()).get("id").asText();
        var created = mvc.perform(post("/api/courses/"+course+"/notes").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"첫 강의\",\"body\":\"# Stack\",\"version\":0}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.updatedAt").isNotEmpty()).andReturn();
        String note = json.readTree(created.getResponse().getContentAsString()).get("id").asText();
        String update = "{\"title\":\"수정\",\"body\":\"# Queue\",\"version\":0}";
        mvc.perform(put("/api/notes/"+note).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.updatedAt").isNotEmpty());
        mvc.perform(put("/api/notes/"+note).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isConflict());
        mvc.perform(get("/api/courses/"+course+"/notes").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].body").value("# Queue"));
        mvc.perform(get("/api/courses/"+course+"/notes").param("q","queue").with(owner)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/courses/"+course+"/notes").param("q","수정").with(owner)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/api/courses/"+course+"/notes").param("q","%").with(owner)).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/courses/"+course+"/notes").param("q","_").with(owner)).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/courses/"+course+"/notes").param("q","x".repeat(201)).with(owner)).andExpect(status().isBadRequest());
        mvc.perform(get("/api/courses/"+course+"/notes").with(user("999999"))).andExpect(status().isNotFound());
        mvc.perform(put("/api/notes/"+note).with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/notes/"+note).with(owner).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.trashed").value(true));
        mvc.perform(get("/api/courses/"+course+"/notes").with(owner)).andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/api/courses/"+course+"/trash").with(owner)).andExpect(jsonPath("$[0].id").value(note));
        mvc.perform(put("/api/notes/"+note).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"title\":\"금지\",\"body\":\"본문\",\"version\":1}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/notes/"+note+"/restore").with(owner).with(csrf())).andExpect(status().isOk()).andExpect(jsonPath("$.restored").value(true));
        mvc.perform(get("/api/courses/"+course+"/notes").with(owner)).andExpect(jsonPath("$[0].id").value(note));
        mvc.perform(delete("/api/notes/"+note).with(user("999999")).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(get("/api/courses")).andExpect(status().isUnauthorized());
    }
    @Test void repeatedCreateRequestDoesNotDuplicateOrOverwriteNotes() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('notes-retry@example.com','test','학생')");
        long id = db.queryForObject("select id from users where email='notes-retry@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('retry-course',?,'2026-2','수업')",id);
        var owner = user(Long.toString(id));
        String input = "{\"title\":\"노트\",\"body\":\"원문\",\"version\":0,\"requestId\":\"04b117d6-e147-42e6-86a3-1a1e431029dc\"}";
        for(int i=0;i<2;i++) mvc.perform(post("/api/courses/retry-course/notes").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.id").value("04b117d6-e147-42e6-86a3-1a1e431029dc"));
        mvc.perform(post("/api/courses/retry-course/notes").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input.replace("원문","변경")))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.body").value("원문"));
        mvc.perform(get("/api/courses/retry-course/notes").with(owner)).andExpect(jsonPath("$.length()").value(1));
        mvc.perform(post("/api/courses/retry-course/notes").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(input.replace("04b117d6-e147-42e6-86a3-1a1e431029dc","invalid")))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/courses/retry-course").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"새 수업 이름\",\"archived\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.name").value("새 수업 이름")).andExpect(jsonPath("$.archived").value(true));
        mvc.perform(get("/api/courses").with(owner)).andExpect(jsonPath("$[0].name").value("새 수업 이름")).andExpect(jsonPath("$[0].archived").value(true));
        mvc.perform(put("/api/courses/retry-course").with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"침범\",\"archived\":false}"))
                .andExpect(status().isNotFound());
    }
    @Test void markdownImportPreviewsFrontmatterAndDetectsExactDuplicate() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('import-owner@example.com','test','학생')");
        long id=db.queryForObject("select id from users where email='import-owner@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('import-course',?,'2026-2','수업')",id);
        var owner=user(Long.toString(id));
        var file=new MockMultipartFile("file","week-1.md","text/markdown","---\ntitle: 자료구조 1주차\ntags: [stack]\n---\n# 스택\n본문".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        mvc.perform(multipart("/api/courses/import-course/notes/import/preview").file(file).with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("자료구조 1주차"))
                .andExpect(jsonPath("$.body").value("# 스택\n본문")).andExpect(jsonPath("$.duplicate").value(false));
        db.update("insert into notes(id,course_id,user_id,title,body) values('imported','import-course',?,'자료구조 1주차','# 스택\n본문')",id);
        mvc.perform(multipart("/api/courses/import-course/notes/import/preview").file(file).with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.duplicate").value(true)).andExpect(jsonPath("$.duplicateNoteId").value("imported"));
        mvc.perform(multipart("/api/courses/import-course/notes/import/preview").file(file).with(user("999999")).with(csrf()))
                .andExpect(status().isNotFound());
    }
    @Test void permanentlyDeletesOnlyOwnedTrashedNoteAndQueuesFiles() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('permanent-note@example.com','test','학생')");long id=db.queryForObject("select id from users where email='permanent-note@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('permanent-course',?,'2026-2','수업')",id);db.update("insert into notes(id,course_id,user_id,title,body) values('permanent-note','permanent-course',?,'삭제 노트','본문')",id);db.update("insert into note_trash(note_id,user_id) values('permanent-note',?)",id);
        db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256) values('permanent-file','permanent-note',?,'자료.pdf',?,'application/pdf','pdf',1,?)",id,id+"/missing.pdf","0".repeat(64));
        String recording="20000000-0000-0000-0000-000000000002";db.update("insert into recordings(id,note_id,course_id,user_id,title,status,mime_type,storage_key) values(?,'permanent-note','permanent-course',?,'녹음','READY','audio/webm',?)",recording,id,id+"/"+recording+"/audio.webm");
        var owner=user(Long.toString(id));mvc.perform(get("/api/notes/permanent-note/delete-impact").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$.attachments").value(1)).andExpect(jsonPath("$.recordings").value(1));
        mvc.perform(delete("/api/notes/permanent-note/permanent").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"confirmation\":\"삭제\"}")).andExpect(status().isBadRequest());
        mvc.perform(delete("/api/notes/permanent-note/permanent").with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"confirmation\":\"영구삭제\"}")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/notes/permanent-note/permanent").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"confirmation\":\"영구삭제\"}")).andExpect(status().isOk());
        org.junit.jupiter.api.Assertions.assertEquals(0,db.queryForObject("select count(*) from notes where id='permanent-note'",Integer.class));
        org.junit.jupiter.api.Assertions.assertEquals(1,db.queryForObject("select count(*) from account_file_cleanup where user_id=? and completed_at is not null",Integer.class,id));
        org.junit.jupiter.api.Assertions.assertEquals(1,db.queryForObject("select count(*) from recordings where id=? and note_id is null",Integer.class,recording));
        mvc.perform(get("/api/courses/permanent-course/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(recording));
    }
}
