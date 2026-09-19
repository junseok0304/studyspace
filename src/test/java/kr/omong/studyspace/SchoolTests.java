package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import kr.omong.studyspace.study.SchoolAdapter;
import kr.omong.studyspace.auth.AuthException;
import tools.jackson.databind.ObjectMapper;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;

@SpringBootTest @AutoConfigureMockMvc
class SchoolTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired ObjectMapper json;
    @MockitoBean SchoolAdapter adapter;
    @Test void verifiesBeforeSavingAndPreservesMissingCourses() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('school-test@example.com','test','학교')");
        long id=db.queryForObject("select id from users where email='school-test@example.com'",Long.class);
        var owner=user(Long.toString(id));
        String credentials="{\"username\":\"test-id\",\"password\":\"test-school-password\",\"saveConsent\":true}";
        doThrow(new AuthException("LMS 아이디 또는 비밀번호를 확인해주세요",422)).when(adapter).verify(anyString());
        mvc.perform(put("/api/school").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(credentials)).andExpect(status().isUnprocessableEntity());
        assertEquals(0,db.queryForObject("select count(*) from school_links where user_id=?",Integer.class,id));
        doNothing().when(adapter).verify(anyString());
        mvc.perform(put("/api/school").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(credentials)).andExpect(status().isOk());
        assertFalse(db.queryForObject("select credentials from school_links where user_id=?",String.class,id).contains("test-school-password"));
        String both="{\"year\":2026,\"semester\":\"2\",\"courses\":[{\"code\":\"A\",\"section\":\"1\",\"name\":\"과목A\",\"schedule\":\"월 10:00\"},{\"code\":\"B\",\"section\":\"1\",\"name\":\"과목B\",\"schedule\":\"화 10:00\"}]}";
        when(adapter.fetch(anyString(),eq(2026),eq("2"))).thenReturn(json.readTree(both));
        sync(owner);
        String course=db.queryForObject("select id from courses where user_id=? and name='과목A'",String.class,id);
        db.update("insert into notes(id,course_id,user_id,title,body) values('retained-note',?,?,'보존','본문')",course,id);
        String fewer="{\"year\":2026,\"semester\":\"2\",\"courses\":[{\"code\":\"B\",\"section\":\"1\",\"name\":\"과목B\",\"schedule\":\"수 11:00\"}]}";
        when(adapter.fetch(anyString(),eq(2026),eq("2"))).thenReturn(json.readTree(fewer));
        sync(owner); sync(owner);
        assertEquals(2,db.queryForObject("select count(*) from courses where user_id=?",Integer.class,id));
        assertEquals("본문",db.queryForObject("select body from notes where id='retained-note'",String.class));
        mvc.perform(delete("/api/school").with(owner).with(csrf())).andExpect(status().isOk());
        assertEquals(0,db.queryForObject("select count(*) from school_links where user_id=?",Integer.class,id));
        assertEquals(2,db.queryForObject("select count(*) from courses where user_id=?",Integer.class,id));
    }
    private void sync(org.springframework.test.web.servlet.request.RequestPostProcessor owner) throws Exception {
        mvc.perform(post("/api/school/preview").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"year\":2026,\"semester\":\"2\"}")).andExpect(status().isOk());
        mvc.perform(post("/api/school/confirm").with(owner).with(csrf())).andExpect(status().isOk());
    }
}
