package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest @AutoConfigureMockMvc
class AttachmentReuseTests {
    @Autowired MockMvc mvc; @Autowired JdbcTemplate db; @Autowired ObjectMapper json;
    @Test void reusesCompletedAnalysisInsideTheSameAccount() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('reuse-file@example.com','test','학생')");long id=db.queryForObject("select id from users where email='reuse-file@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('reuse-course',?,'2026-2','수업')",id);db.update("insert into notes(id,course_id,user_id,title,body) values('reuse-note','reuse-course',?,'노트','본문')",id);var owner=user(Long.toString(id));byte[] pdf="%PDF-test-content".getBytes();
        var first=mvc.perform(multipart("/api/notes/reuse-note/attachments").file(new MockMultipartFile("file","first.pdf","application/pdf",pdf)).with(owner).with(csrf())).andExpect(status().isCreated()).andReturn();
        String firstId=json.readTree(first.getResponse().getContentAsString()).path("id").asText();db.update("update attachments set analysis_status='TEXT_READY',extracted_text='재사용할 분석',analyzed_at=current_timestamp where id=?",firstId);
        mvc.perform(multipart("/api/notes/reuse-note/attachments").file(new MockMultipartFile("file","second.pdf","application/pdf",pdf)).with(owner).with(csrf()))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.analysisStatus").value("TEXT_READY")).andExpect(jsonPath("$.reusedAnalysis").value(true)).andExpect(jsonPath("$.extractedLength").value(7));
        mvc.perform(get("/api/attachments/"+firstId+"/analysis").with(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$.originalName").value("first.pdf")).andExpect(jsonPath("$.extractedText").value("재사용할 분석"));
        mvc.perform(get("/api/attachments/"+firstId+"/analysis").with(user("999999"))).andExpect(status().isNotFound());
    }
}
