package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class AccountDeletionTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;

    @Test void passwordConfirmationDeletesDatabaseAndQueuesPhysicalFiles() throws Exception {
        String hash=passwords.encode("correct-password");
        db.update("insert into users(email,password_hash,nickname) values('delete-owner@example.com',?,'학생')",hash);
        long id=db.queryForObject("select id from users where email='delete-owner@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('delete-course',?,'2026-2','자료구조')",id);
        db.update("insert into notes(id,course_id,user_id,title,body) values('delete-note','delete-course',?,'노트','본문')",id);
        db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256) values('delete-file','delete-note',?,'자료.pdf',?,'application/pdf','pdf',1,?)",id,id+"/missing.pdf","0".repeat(64));
        String recording="10000000-0000-0000-0000-000000000001";
        db.update("insert into recordings(id,note_id,course_id,user_id,title,status,mime_type,storage_key) values(?,'delete-note','delete-course',?,'녹음','READY','audio/webm',?)",recording,id,id+"/"+recording+"/audio.webm");

        var actor=user(Long.toString(id));
        mvc.perform(delete("/api/account").with(actor).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"wrong-password\",\"confirmation\":\"회원탈퇴\"}"))
                .andExpect(status().isBadRequest());
        assertEquals(1,db.queryForObject("select count(*) from users where id=?",Integer.class,id));

        mvc.perform(delete("/api/account").with(actor).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"password\":\"correct-password\",\"confirmation\":\"회원탈퇴\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.deleted").value(true));
        assertEquals(0,db.queryForObject("select count(*) from users where id=?",Integer.class,id));
        assertEquals(2,db.queryForObject("select count(*) from account_file_cleanup where user_id=? and completed_at is not null",Integer.class,id));
        mvc.perform(get("/api/auth/me").with(actor)).andExpect(status().isUnauthorized());
    }
}
