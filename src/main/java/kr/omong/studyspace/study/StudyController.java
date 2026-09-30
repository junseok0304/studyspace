package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api")
public class StudyController {
    private final JdbcTemplate db; private final TransactionTemplate tx; private final AccountFileCleanupService cleanup; private final AuthSupport authSupport;
    public StudyController(JdbcTemplate db,PlatformTransactionManager manager,AccountFileCleanupService cleanup,AuthSupport authSupport) { this.db = db;this.tx=new TransactionTemplate(manager);this.cleanup=cleanup;this.authSupport=authSupport; }
    public record Course(String id, String semester, String name, boolean archived, int noteCount, int reviewCount) {}
    public record Semester(String name) {}
    public record SemesterInput(@NotBlank @Size(max=40) String name) {}
    public record CourseInput(@NotBlank @Size(max=40) String semester, @NotBlank @Size(max=120) String name) {}
    public record CourseUpdate(@NotBlank @Size(max=120) String name, boolean archived) {}
    public record Note(String id, String courseId, String title, String body, long version, String updatedAt) {}
    public record TrashedNote(String id,String title,String deletedAt) {}
    public record DeleteImpact(int attachments,int recordings,int artifacts,int quizSets,int flashcardDecks) {}
    public record PermanentDelete(@NotNull @Pattern(regexp="영구삭제") String confirmation) {}
    public record MarkdownImportPreview(String title,String body,boolean duplicate,String duplicateNoteId) {}
    public record NoteInput(@NotBlank @Size(max=200) String title, @NotNull @Size(max=61000) String body, @Min(0) long version,
                            @Pattern(regexp="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") String requestId) {}
    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }
    private void requireCourse(String id, long user) { authSupport.requireCourse(id,user); }
    private Note findNote(String id,String courseId,long user) {
        return db.queryForObject("select * from notes where id=? and course_id=? and user_id=?",
                (row,index) -> new Note(row.getString("id"),row.getString("course_id"),row.getString("title"),row.getString("body"),row.getLong("version"),row.getTimestamp("updated_at").toInstant().toString()),
                id,courseId,user);
    }
    @GetMapping("/semesters")
    public List<Semester> semesters(Authentication auth) {
        long user = owner(auth);
        return db.query("select name from semesters where user_id=? union select distinct semester as name from courses where user_id=? order by name desc",
                (row, index) -> new Semester(row.getString("name")), user, user);
    }
    @PostMapping("/semesters")
    @ResponseStatus(HttpStatus.CREATED)
    public Semester createSemester(Authentication auth, @Valid @RequestBody SemesterInput input) {
        long user = owner(auth);
        String name = input.name().trim();
        try { db.update("insert into semesters(user_id,name) values(?,?)", user, name); }
        catch (DuplicateKeyException ignored) { /* Adding an existing semester is idempotent. */ }
        return new Semester(name);
    }
    @GetMapping("/courses")
    public List<Course> courses(Authentication auth) {
        long user = owner(auth);
        return db.query("""
                select c.*, coalesce(s.archived,false) archived,
                  (select count(*) from notes n where n.course_id=c.id and n.user_id=c.user_id
                     and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)) note_count,
                  (select count(distinct n.id) from learning_artifacts a join notes n on n.id=a.note_id
                     where a.user_id=c.user_id and n.course_id=c.id and a.kind in ('SUMMARY','AI_NOTE')) review_count
                from courses c left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
                where c.user_id=? order by c.semester desc,c.name
                """, (r, n) -> new Course(r.getString("id"), r.getString("semester"), r.getString("name"), r.getBoolean("archived"), r.getInt("note_count"), r.getInt("review_count")), user);
    }
    @PostMapping("/courses") @ResponseStatus(HttpStatus.CREATED)
    public Course createCourse(Authentication auth, @Valid @RequestBody CourseInput input) {
        var course = new Course(UUID.randomUUID().toString(), input.semester().trim(), input.name().trim(), false, 0, 0);
        db.update("insert into courses(id,user_id,semester,name) values(?,?,?,?)", course.id(), owner(auth), course.semester(), course.name());
        return course;
    }
    @PutMapping("/courses/{id}")
    public Course updateCourse(Authentication auth,@PathVariable String id,@Valid @RequestBody CourseUpdate input) {
        long user=owner(auth);
        requireCourse(id,user);
        String name=input.name().trim();
        db.update("update courses set name=? where id=? and user_id=?",name,id,user);
        if(db.update("update course_settings set archived=? where course_id=? and user_id=?",input.archived(),id,user)==0) {
            try { db.update("insert into course_settings(course_id,user_id,archived) values(?,?,?)",id,user,input.archived()); }
            catch(DuplicateKeyException retry) { db.update("update course_settings set archived=? where course_id=? and user_id=?",input.archived(),id,user); }
        }
        String semester = db.queryForObject("select semester from courses where id=? and user_id=?", String.class, id, user);
        return new Course(id, semester, name, input.archived(), 0, 0);
    }
    @GetMapping("/courses/{id}/notes")
    public List<Note> notes(Authentication auth, @PathVariable String id, @RequestParam(defaultValue="") String q) {
        requireCourse(id,owner(auth));
        if (q.length() > 200) throw new AuthException("검색어는 200자 이하로 입력해주세요.",400);
        String pattern = "%" + q.trim().toLowerCase(Locale.ROOT).replace("!","!!").replace("%","!%").replace("_","!_") + "%";
        return db.query("select * from notes n where course_id=? and user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id) and (lower(title) like ? escape '!' or lower(body) like ? escape '!') order by updated_at desc, id",
                (r,n) -> new Note(r.getString("id"),id,r.getString("title"),r.getString("body"),r.getLong("version"),r.getTimestamp("updated_at").toInstant().toString()), id,owner(auth),pattern,pattern);
    }
    @GetMapping("/courses/{id}/trash")
    public List<TrashedNote> trash(Authentication auth,@PathVariable String id) {
        long user=owner(auth); requireCourse(id,user);
        return db.query("select n.id,n.title,t.deleted_at from note_trash t join notes n on n.id=t.note_id and n.user_id=t.user_id where n.course_id=? and t.user_id=? order by t.deleted_at desc,n.id",
                (row,index) -> new TrashedNote(row.getString("id"),row.getString("title"),row.getTimestamp("deleted_at").toInstant().toString()),id,user);
    }
    @PostMapping("/courses/{id}/notes/import/preview")
    public MarkdownImportPreview previewMarkdown(Authentication auth,@PathVariable String id,
                                                  @RequestParam("file") MultipartFile file) throws IOException {
        long user=owner(auth); requireCourse(id,user);
        if(file==null || file.isEmpty()) throw new AuthException("가져올 Markdown 파일을 선택해 주세요.",400);
        String filename=Optional.ofNullable(file.getOriginalFilename()).orElse("note.md");
        if(!filename.toLowerCase(Locale.ROOT).endsWith(".md")) throw new AuthException("Markdown(.md) 파일만 가져올 수 있습니다.",415);
        if(file.getSize()>100_000) throw new AuthException("Markdown 파일은 100KB 이하만 가져올 수 있습니다.",413);
        String source=new String(file.getBytes(),StandardCharsets.UTF_8).replace("\r\n","\n").replace('\r','\n');
        if(source.indexOf('\0')>=0) throw new AuthException("텍스트 Markdown 파일을 선택해 주세요.",415);
        String body=source; String title=filename.substring(0,Math.max(1,filename.length()-3)).trim();
        if(source.startsWith("---\n")) {
            int end=source.indexOf("\n---\n",4);
            if(end>0) {
                for(String line:source.substring(4,end).split("\n")) if(line.toLowerCase(Locale.ROOT).startsWith("title:")) {
                    String candidate=line.substring(line.indexOf(':')+1).trim().replaceAll("^[\\\"']|[\\\"']$","");
                    if(!candidate.isBlank()) title=candidate;
                }
                body=source.substring(end+5);
            }
        }
        if(title.isBlank()) title="가져온 노트";
        if(title.length()>200 || body.length()>60000) throw new AuthException("노트 제목 또는 본문이 허용 길이를 초과했습니다.",400);
        List<String> duplicates=db.queryForList("select id from notes where course_id=? and user_id=? and title=? and body=?",String.class,id,user,title,body);
        return new MarkdownImportPreview(title,body,!duplicates.isEmpty(),duplicates.isEmpty()?null:duplicates.getFirst());
    }
    @PostMapping("/courses/{id}/notes") @ResponseStatus(HttpStatus.CREATED)
    public Note createNote(Authentication auth, @PathVariable String id, @Valid @RequestBody NoteInput input) {
        requireCourse(id,owner(auth));
        var note = new Note(input.requestId() == null ? UUID.randomUUID().toString() : input.requestId(),id,input.title().trim(),input.body(),0,null);
        try {
            db.update("insert into notes(id,course_id,user_id,title,body) values(?,?,?,?,?)",note.id(),id,owner(auth),note.title(),note.body());
        } catch (DuplicateKeyException duplicate) {
            var existing = db.query("select * from notes where id=? and course_id=? and user_id=?",
                    (r,n) -> new Note(r.getString("id"),id,r.getString("title"),r.getString("body"),r.getLong("version"),r.getTimestamp("updated_at").toInstant().toString()),note.id(),id,owner(auth));
            if (existing.isEmpty()) throw new AuthException("요청을 처리하지 못했습니다. 새 노트로 다시 시도해주세요.",409);
            return existing.getFirst();
        }
        return findNote(note.id(),id,owner(auth));
    }
    @PutMapping("/notes/{id}")
    public Note saveNote(Authentication auth, @PathVariable String id, @Valid @RequestBody NoteInput input) {
        var courses = db.queryForList("select course_id from notes n where id=? and user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)",String.class,id,owner(auth));
        if (courses.isEmpty()) throw new AuthException("노트를 찾을 수 없습니다.",404);
        int updated = db.update("update notes set title=?,body=?,version=version+1,updated_at=current_timestamp where id=? and user_id=? and version=?",input.title().trim(),input.body(),id,owner(auth),input.version());
        if(updated != 1) throw new AuthException("다른 화면에서 수정된 노트입니다. 현재 내용을 복사한 뒤 다시 열어 주세요.",409);
        return findNote(id,courses.getFirst(),owner(auth));
    }
    @DeleteMapping("/notes/{id}")
    public Map<String,Boolean> trashNote(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        if(db.queryForObject("select count(*) from notes where id=? and user_id=?",Integer.class,id,user)!=1) throw new AuthException("노트를 찾을 수 없습니다.",404);
        try { db.update("insert into note_trash(note_id,user_id) values(?,?)",id,user); }
        catch(DuplicateKeyException ignored) { /* Repeated delete stays safely in trash. */ }
        return Map.of("trashed",true);
    }
    @PostMapping("/notes/{id}/restore")
    public Map<String,Boolean> restoreNote(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        if(db.update("delete from note_trash where note_id=? and user_id=?",id,user)!=1) throw new AuthException("휴지통에서 노트를 찾을 수 없습니다.",404);
        return Map.of("restored",true);
    }
    @GetMapping("/notes/{id}/delete-impact")
    public DeleteImpact deleteImpact(Authentication auth,@PathVariable String id) {
        long user=owner(auth);requireTrashed(id,user);
        return new DeleteImpact(count("attachments",id,user),count("recordings",id,user),count("learning_artifacts",id,user),count("quiz_sets",id,user),count("flashcard_decks",id,user));
    }
    @DeleteMapping("/notes/{id}/permanent")
    public Map<String,Boolean> permanentlyDelete(Authentication auth,@PathVariable String id,@Valid @RequestBody PermanentDelete input) {
        long user=owner(auth);requireTrashed(id,user);
        tx.executeWithoutResult(status->{
            db.queryForList("select storage_key from attachments where note_id=? and user_id=?",String.class,id,user).forEach(key->db.update("insert into account_file_cleanup(kind,user_id,item_key) values('ATTACHMENT',?,?)",user,key));
            if(db.update("delete from notes where id=? and user_id=?",id,user)!=1)throw new AuthException("휴지통에서 노트를 찾을 수 없습니다.",404);
        });
        cleanup.cleanupPending();return Map.of("deleted",true);
    }
    private void requireTrashed(String id,long user){Integer found=db.queryForObject("select count(*) from note_trash where note_id=? and user_id=?",Integer.class,id,user);if(found==null||found!=1)throw new AuthException("휴지통에서 노트를 찾을 수 없습니다.",404);}
    private int count(String table,String id,long user){return Optional.ofNullable(db.queryForObject("select count(*) from "+table+" where note_id=? and user_id=?",Integer.class,id,user)).orElse(0);}
}
