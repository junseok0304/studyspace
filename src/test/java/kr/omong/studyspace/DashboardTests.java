package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;

@SpringBootTest
@AutoConfigureMockMvc
class DashboardTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Test void countsRealActivityPerDayFiltersSemesterAndIsolatesUsers() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('dashboard@example.com','test','학생')");
        long id = db.queryForObject("select id from users where email='dashboard@example.com'",Long.class);
        var owner = user(Long.toString(id));
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$.notes").value(0)).andExpect(jsonPath("$.days.length()").value(7));
        db.update("insert into courses(id,user_id,semester,name) values('dash-course',?,'2026-2','자료구조')",id);
        db.update("insert into notes(id,user_id,course_id,title,body) values('dash-note',?,'dash-course','스택','노트')",id);
        String day = switch (LocalDate.now(ZoneId.of("Asia/Seoul")).getDayOfWeek()) {
            case MONDAY -> "월"; case TUESDAY -> "화"; case WEDNESDAY -> "수"; case THURSDAY -> "목";
            case FRIDAY -> "금"; case SATURDAY -> "토"; case SUNDAY -> "일";
        };
        db.update("insert into school_courses(user_id,external_id,course_id,schedule) values(?,'dash-external','dash-course',?)",id,day+"요일/09:00~10:15/6201, 월요일/13:00~14:00/6202");
        for(int i=0;i<2;i++) mvc.perform(post("/api/notes/dash-note/activity").with(owner).with(csrf())).andExpect(status().isOk());
        db.update("insert into note_activity(user_id,note_id,activity_date) values(?,'dash-note',?)",id,LocalDate.now(ZoneId.of("Asia/Seoul")).minusDays(1));
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.courses").value(1)).andExpect(jsonPath("$.notes").value(1))
                .andExpect(jsonPath("$.viewed").value(1)).andExpect(jsonPath("$.activeDays").value(2))
                .andExpect(jsonPath("$.days[6].count").value(1)).andExpect(jsonPath("$.courseStats[0].viewed").value(1))
                .andExpect(jsonPath("$.recent[0].id").value("dash-note"))
                .andExpect(jsonPath("$.quizTarget.id").value("dash-note"))
                .andExpect(jsonPath("$.todayClasses[0].name").value("자료구조"))
                .andExpect(jsonPath("$.todayClasses[0].start").value("09:00"))
                .andExpect(jsonPath("$.todayClasses[0].room").value("6201"))
                .andExpect(jsonPath("$.flashcardsDue").value(0));
        db.update("insert into flashcard_decks(id,request_id,user_id,course_id,note_id,title,source_note_version) values('dash-deck','77777777-7777-4777-8777-777777777777',?,'dash-course','dash-note','복습',1)",id);
        db.update("insert into flashcards(id,deck_id,card_order,front_text,back_text,explanation,source_label) values('dash-card','dash-deck',0,'질문','답','해설','노트')");
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(jsonPath("$.flashcardsDue").value(1))
                .andExpect(jsonPath("$.reviewTarget.id").value("dash-note"))
                .andExpect(jsonPath("$.reviewTarget.courseId").value("dash-course"));
        mvc.perform(get("/api/dashboard?semester=2026-1").with(owner)).andExpect(jsonPath("$.notes").value(0)).andExpect(jsonPath("$.activeDays").value(0)).andExpect(jsonPath("$.todayClasses.length()").value(0));
        db.update("insert into note_trash(note_id,user_id) values('dash-note',?)",id);
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(jsonPath("$.courses").value(1)).andExpect(jsonPath("$.notes").value(0)).andExpect(jsonPath("$.activeDays").value(0)).andExpect(jsonPath("$.recent.length()").value(0)).andExpect(jsonPath("$.flashcardsDue").value(0));
        db.update("insert into course_settings(course_id,user_id,archived) values('dash-course',?,true)",id);
        mvc.perform(get("/api/dashboard").with(owner)).andExpect(jsonPath("$.courses").value(0)).andExpect(jsonPath("$.notes").value(0)).andExpect(jsonPath("$.todayClasses.length()").value(0));
        mvc.perform(get("/api/dashboard").with(user("999999"))).andExpect(jsonPath("$.notes").value(0));
        mvc.perform(post("/api/notes/dash-note/activity").with(user("999999")).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(post("/api/notes/dash-note/activity").with(owner)).andExpect(status().isForbidden());
        mvc.perform(get("/api/dashboard")).andExpect(status().isUnauthorized());
        mvc.perform(get("/workspace.css")).andExpect(status().isOk());
    }
}
