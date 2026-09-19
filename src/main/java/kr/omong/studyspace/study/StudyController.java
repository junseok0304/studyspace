package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import java.util.*;

@RestController
@RequestMapping("/api")
public class StudyController {
    private final JdbcTemplate db;
    public StudyController(JdbcTemplate db) { this.db = db; }
    public record Course(String id, String semester, String name) {}
    public record CourseInput(@NotBlank @Size(max=40) String semester, @NotBlank @Size(max=120) String name) {}
    public record Note(String id, String courseId, String title, String body, long version) {}
    public record NoteInput(@NotBlank @Size(max=200) String title, @NotNull @Size(max=60000) String body, @Min(0) long version) {}
    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }
    private void requireCourse(String id, long user) {
        if (db.queryForObject("select count(*) from courses where id=? and user_id=?", Integer.class, id, user) != 1)
            throw new AuthException("과목을 찾을 수 없습니다.", 404);
    }
    @GetMapping("/courses")
    public List<Course> courses(Authentication auth) {
        return db.query("select * from courses where user_id=? order by semester desc, name", (r,n) -> new Course(r.getString("id"),r.getString("semester"),r.getString("name")), owner(auth));
    }
    @PostMapping("/courses") @ResponseStatus(HttpStatus.CREATED)
    public Course createCourse(Authentication auth, @Valid @RequestBody CourseInput input) {
        var course = new Course(UUID.randomUUID().toString(), input.semester().trim(), input.name().trim());
        db.update("insert into courses(id,user_id,semester,name) values(?,?,?,?)", course.id(),owner(auth),course.semester(),course.name());
        return course;
    }
    @GetMapping("/courses/{id}/notes")
    public List<Note> notes(Authentication auth, @PathVariable String id) {
        requireCourse(id,owner(auth));
        return db.query("select * from notes where course_id=? and user_id=? order by updated_at desc, id", (r,n) -> new Note(r.getString("id"),id,r.getString("title"),r.getString("body"),r.getLong("version")), id,owner(auth));
    }
    @PostMapping("/courses/{id}/notes") @ResponseStatus(HttpStatus.CREATED)
    public Note createNote(Authentication auth, @PathVariable String id, @Valid @RequestBody NoteInput input) {
        requireCourse(id,owner(auth));
        var note = new Note(UUID.randomUUID().toString(),id,input.title().trim(),input.body(),0);
        db.update("insert into notes(id,course_id,user_id,title,body) values(?,?,?,?,?)",note.id(),id,owner(auth),note.title(),note.body());
        return note;
    }
    @PutMapping("/notes/{id}")
    public Note saveNote(Authentication auth, @PathVariable String id, @Valid @RequestBody NoteInput input) {
        var courses = db.queryForList("select course_id from notes where id=? and user_id=?",String.class,id,owner(auth));
        if (courses.isEmpty()) throw new AuthException("노트를 찾을 수 없습니다.",404);
        int updated = db.update("update notes set title=?,body=?,version=version+1,updated_at=current_timestamp where id=? and user_id=? and version=?",input.title().trim(),input.body(),id,owner(auth),input.version());
        if(updated != 1) throw new AuthException("다른 화면에서 수정된 노트입니다. 현재 내용을 복사한 뒤 다시 열어 주세요.",409);
        return new Note(id,courses.getFirst(),input.title().trim(),input.body(),input.version()+1);
    }
}
