package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

@Component
public class AuthSupport {
    private final JdbcTemplate db;
    public AuthSupport(JdbcTemplate db) { this.db = db; }

    public long owner(Authentication auth) { return Long.parseLong(auth.getName()); }

    public void requireNote(String noteId, long user) {
        Integer found = db.queryForObject("select count(*) from notes n where id=? and user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)", Integer.class, noteId, user);
        if (found == null || found != 1) throw new AuthException("노트를 찾을 수 없습니다.", 404);
    }

    public void requireCourse(String courseId, long user) {
        Integer found = db.queryForObject("select count(*) from courses where id=? and user_id=?", Integer.class, courseId, user);
        if (found == null || found != 1) throw new AuthException("과목을 찾을 수 없습니다.", 404);
    }
}