package kr.omong.studyspace;

import kr.omong.studyspace.auth.AuthException;
import kr.omong.studyspace.study.StorageQuotaService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties="STUDYSPACE_STORAGE_LIMIT_BYTES=100") @AutoConfigureMockMvc
class StorageQuotaTests {
    @Autowired JdbcTemplate db; @Autowired MockMvc mvc; @Autowired StorageQuotaService quota;
    @Test void sumsOnlyOwnedFilesAndRejectsBytesBeyondTheLimit() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('quota@example.com','test','학생')");long id=db.queryForObject("select id from users where email='quota@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('quota-course',?,'2026-2','수업')",id);db.update("insert into notes(id,course_id,user_id,title,body) values('quota-note','quota-course',?,'노트','본문')",id);
        db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256) values('quota-file','quota-note',?,'자료.pdf',?,'application/pdf','pdf',40,?)",id,id+"/missing.pdf","0".repeat(64));
        db.update("insert into recordings(id,note_id,course_id,user_id,title,status,mime_type,size_bytes) values('30000000-0000-0000-0000-000000000003','quota-note','quota-course',?,'녹음','RECORDING','audio/webm',30)",id);
        mvc.perform(get("/api/account/storage").with(user(Long.toString(id)))).andExpect(status().isOk()).andExpect(jsonPath("$.usedBytes").value(70)).andExpect(jsonPath("$.remainingBytes").value(30)).andExpect(jsonPath("$.usedPercent").value(70.0));
        LocalDate today=LocalDate.now(ZoneId.of("Asia/Seoul"));
        db.update("insert into ai_usage_daily(user_id,usage_date,request_count) values(?,?,4)",id,today);
        mvc.perform(get("/api/account/ai-usage").with(user(Long.toString(id))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.used").value(4))
                .andExpect(jsonPath("$.limit").value(30)).andExpect(jsonPath("$.remaining").value(26));
        quota.requireAvailable(id,30);assertThrows(AuthException.class,()->quota.requireAvailable(id,31));
        mvc.perform(get("/api/account/storage")).andExpect(status().isUnauthorized());
    }
}
