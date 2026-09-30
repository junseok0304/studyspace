package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AccountExportTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;

    @Test void exportContainsOnlyOwnersMarkdownWithFrontmatter() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('export-owner@example.com','test','학생')");
        db.update("insert into users(email,password_hash,nickname) values('export-other@example.com','test','다른 학생')");
        long owner=db.queryForObject("select id from users where email='export-owner@example.com'",Long.class);
        long other=db.queryForObject("select id from users where email='export-other@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('export-course',?,'2026-2','자료구조')",owner);
        db.update("insert into courses(id,user_id,semester,name) values('export-other-course',?,'2026-2','비공개')",other);
        db.update("insert into notes(id,course_id,user_id,title,body) values('export-note','export-course',?,'스택','# Stack')",owner);
        db.update("insert into notes(id,course_id,user_id,title,body) values('export-other-note','export-other-course',?,'타인 노트','secret')",other);

        var started=mvc.perform(get("/api/account/export").with(user(Long.toString(owner))))
                .andExpect(request().asyncStarted()).andReturn();
        var completed=mvc.perform(asyncDispatch(started)).andExpect(status().isOk()).andReturn();
        Map<String,String> entries=new HashMap<>();
        try(var zip=new ZipInputStream(new ByteArrayInputStream(completed.getResponse().getContentAsByteArray()),StandardCharsets.UTF_8)) {
            for(var entry=zip.getNextEntry();entry!=null;entry=zip.getNextEntry()) entries.put(entry.getName(),new String(zip.readAllBytes(),StandardCharsets.UTF_8));
        }
        assertTrue(entries.keySet().stream().anyMatch(name->name.startsWith("notes/2026-2/자료구조/스택-export-n.md")));
        assertTrue(entries.values().stream().anyMatch(value->value.contains("title: \"스택\"") && value.contains("# Stack")));
        assertTrue(entries.values().stream().noneMatch(value->value.contains("타인 노트") || value.contains("secret")));
    }
}
