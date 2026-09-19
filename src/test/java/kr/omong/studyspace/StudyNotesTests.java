package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
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
                .andExpect(status().isCreated()).andReturn();
        String note = json.readTree(created.getResponse().getContentAsString()).get("id").asText();
        String update = "{\"title\":\"수정\",\"body\":\"# Queue\",\"version\":0}";
        mvc.perform(put("/api/notes/"+note).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        mvc.perform(put("/api/notes/"+note).with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isConflict());
        mvc.perform(get("/api/courses/"+course+"/notes").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].body").value("# Queue"));
        mvc.perform(get("/api/courses/"+course+"/notes").with(user("999999"))).andExpect(status().isNotFound());
        mvc.perform(put("/api/notes/"+note).with(user("999999")).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(update)).andExpect(status().isNotFound());
        mvc.perform(get("/api/courses")).andExpect(status().isUnauthorized());
    }
}
