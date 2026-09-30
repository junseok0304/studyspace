package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.UUID;
import java.util.regex.Matcher;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api")
public class GenerationController {
    private final JdbcTemplate db;
    private final GenerationWorker worker;
    private final TransactionTemplate tx;
    private final String model;
    private final boolean mockEnabled;
    private final ObjectMapper json;

    public GenerationController(JdbcTemplate db, GenerationWorker worker,TransactionTemplate tx,
                                @Value("${studyspace.ai.model:gemini-3.6-flash}") String model,
                                @Value("${studyspace.ai.mock-enabled:true}") boolean mockEnabled,ObjectMapper json) {
        this.db=db;
        this.worker=worker;
        this.tx=tx;
        this.model=model;
        this.mockEnabled=mockEnabled;
        this.json=json;
    }

    public record CreateGeneration(
            @NotNull @Pattern(regexp="SUMMARY|SUBJECTIVE_QUIZ|AI_NOTE|MIND_MAP|INFOGRAPHIC") String kind,
            @NotNull @Pattern(regexp="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") String requestId,
            @Size(max=10) List<@Pattern(regexp="[A-Za-z0-9-]{1,64}") String> attachmentIds,
            @Pattern(regexp="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") String regenerateFromJobId) {}
    public record RetryGeneration(
            @NotNull @Pattern(regexp="[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}") String requestId) {}
    public record Generation(String id,String noteId,String kind,String status,long sourceNoteVersion,String model,
                             boolean mockResult,String errorCode,String createdAt,String completedAt,
                             int attachmentCount,String artifactId,String title,String content,long artifactVersion,
                             String regenerateFromJobId) {}
    public record GenerationSource(long noteVersion,String noteTitle,List<SourceEvidence> attachments) {}
    public record SourceEvidence(String id,String name,List<String> locations,boolean available) {}
    private static final java.util.regex.Pattern LOCATION_MARKER=java.util.regex.Pattern.compile("(?m)^## (PDF 페이지 \\d+|슬라이드 \\d+|HWP 구역 \\d+)\\s*$");
    public record ReviewSource(String id,String noteId,String noteTitle,String title,String kind,String content,long version,String createdAt) {}
    public record UpdateArtifact(@NotBlank @Size(max=200) String title,@NotNull @Size(max=100000) String content,@Min(0) long version) {}
    public record JobSummary(String id,String noteId,String courseId,String noteTitle,String kind,String status,String errorCode,String completedAt,String artifactId) {}

    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }

    @GetMapping("/ai/config")
    public Map<String,Object> config(Authentication auth) {
        owner(auth);
        return Map.of("mockEnabled",mockEnabled,"model",model);
    }

    @GetMapping("/notes/{noteId}/generations")
    public List<Generation> list(Authentication auth,@PathVariable String noteId) {
        long user=owner(auth);
        requireNote(noteId,user);
        return db.query(baseSelect()+" where j.note_id=? and j.user_id=? order by j.created_at desc,j.id",
                (row,index) -> map(row),noteId,user);
    }

    @GetMapping("/generations")
    public List<JobSummary> allJobs(Authentication auth) {
        long user=owner(auth);
        return db.query("""
                select j.id,j.note_id,n.course_id,coalesce(j.source_title,n.title) note_title,j.kind,j.status,j.error_code,j.completed_at,a.id artifact_id
                from generation_jobs j join notes n on n.id=j.note_id and n.user_id=j.user_id
                left join learning_artifacts a on a.job_id=j.id and a.user_id=j.user_id
                where j.user_id=? order by j.created_at desc,j.id limit 50
                """, (row,index)->new JobSummary(row.getString("id"),row.getString("note_id"),row.getString("course_id"),row.getString("note_title"),row.getString("kind"),row.getString("status"),row.getString("error_code"),row.getTimestamp("completed_at")==null?null:row.getTimestamp("completed_at").toInstant().toString(),row.getString("artifact_id")),user);
    }

    @GetMapping("/courses/{courseId}/review-sources")
    public List<ReviewSource> reviewSources(Authentication auth,@PathVariable String courseId) {
        long user=owner(auth);
        if(db.queryForObject("select count(*) from courses where id=? and user_id=?",Integer.class,courseId,user)!=1) throw new AuthException("과목을 찾을 수 없습니다.",404);
        return db.query("select a.id,a.note_id,n.title note_title,a.title,a.kind,a.content,a.version,a.created_at from learning_artifacts a join notes n on n.id=a.note_id and n.user_id=a.user_id where a.user_id=? and n.course_id=? and a.kind in ('SUMMARY','AI_NOTE') order by a.created_at desc,a.id",
                (row,index)->new ReviewSource(row.getString("id"),row.getString("note_id"),row.getString("note_title"),row.getString("title"),row.getString("kind"),row.getString("content"),row.getLong("version"),row.getTimestamp("created_at").toInstant().toString()),user,courseId);
    }

    @GetMapping("/generations/{id}/sources")
    public GenerationSource sources(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        var jobs=db.query("select source_note_version,source_title from generation_jobs where id=? and user_id=?",
                (row,index)->new SourceHeader(row.getLong("source_note_version"),row.getString("source_title")),id,user);
        if(jobs.isEmpty()) throw new AuthException("생성 작업을 찾을 수 없습니다.",404);
        var attachments=db.query("""
                select s.source_id,s.original_name,s.extracted_text,case when a.id is null then false else true end available
                from generation_job_sources s left join attachments a on a.id=s.source_id and a.user_id=?
                where s.job_id=? order by s.source_order
                """, (row,index)->new SourceEvidence(row.getString("source_id"),row.getString("original_name"),locations(row.getString("extracted_text")),row.getBoolean("available")),user,id);
        var job=jobs.getFirst();
        return new GenerationSource(job.noteVersion(),job.noteTitle(),attachments);
    }

    @PostMapping("/notes/{noteId}/generations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Generation create(Authentication auth,@PathVariable String noteId,@Valid @RequestBody CreateGeneration input) {
        long user=owner(auth);
        var replay=findByRequest(input.requestId(),user);
        if(!replay.isEmpty()) return replay.getFirst();
        NoteVersion note=requireNote(noteId,user);
        requireRegenerationSource(input.regenerateFromJobId(),noteId,input.kind(),user);
        if (!mockEnabled && !Boolean.TRUE.equals(db.queryForObject("select email_verified from users where id=?",Boolean.class,user))) throw new AuthException("이메일 인증 후 AI 생성을 이용할 수 있습니다.",403);
        requireWithinLimits(user);
        List<AttachmentSource> sources=requireAttachments(input.attachmentIds(),noteId,user);
        String id=UUID.randomUUID().toString();
        try {
            tx.executeWithoutResult(status -> {
                db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,source_title,source_body,model,mock_result,regenerate_from_job_id) values(?,?,?,?,?,'PENDING',?,?,?,?,?,?)",
                        id,input.requestId(),user,noteId,input.kind(),note.version(),note.title(),note.body(),model,mockEnabled,input.regenerateFromJobId());
                for(int index=0;index<sources.size();index++) {
                    AttachmentSource source=sources.get(index);
                    db.update("insert into generation_job_sources(job_id,source_id,original_name,extracted_text,source_order) values(?,?,?,?,?)",id,source.id(),source.name(),source.text(),index);
                }
            });
        } catch (DuplicateKeyException duplicate) {
            var existing=findByRequest(input.requestId(),user);
            if (existing.isEmpty()) throw new AuthException("생성 요청을 다시 시도해 주세요.",409);
            return existing.getFirst();
        }
        worker.enqueue(id,user);
        return find(id,user);
    }

    @PostMapping("/generations/{id}/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Generation retry(Authentication auth,@PathVariable String id,@Valid @RequestBody RetryGeneration input) {
        long user=owner(auth);
        if (!mockEnabled && !Boolean.TRUE.equals(db.queryForObject("select email_verified from users where id=?",Boolean.class,user))) throw new AuthException("이메일 인증 후 AI 생성을 이용할 수 있습니다.",403);
        var originals=db.query("select note_id,kind,source_note_version,source_title,source_body,model from generation_jobs where id=? and user_id=? and status in ('FAILED','CANCELED')",
                (row,index) -> new RetrySource(row.getString("note_id"),row.getString("kind"),row.getLong("source_note_version"),row.getString("source_title"),row.getString("source_body"),row.getString("model")),id,user);
        if(originals.isEmpty()) throw new AuthException("다시 시도할 수 있는 생성 작업을 찾을 수 없습니다.",404);
        requireWithinLimits(user);
        RetrySource source=originals.getFirst();
        NoteVersion current=requireNote(source.noteId(),user);
        String retryId=UUID.randomUUID().toString();
        String title=source.title()==null ? current.title() : source.title();
        String body=source.body()==null ? current.body() : source.body();
        try {
            tx.executeWithoutResult(status -> {
                db.update("insert into generation_jobs(id,request_id,user_id,note_id,kind,status,source_note_version,source_title,source_body,model,mock_result) values(?,?,?,?,?,'PENDING',?,?,?,?,?)",
                        retryId,input.requestId(),user,source.noteId(),source.kind(),source.version(),title,body,source.model(),mockEnabled);
                db.update("insert into generation_job_sources(job_id,source_id,original_name,extracted_text,source_order) select ?,source_id,original_name,extracted_text,source_order from generation_job_sources where job_id=?",retryId,id);
            });
        } catch (DuplicateKeyException duplicate) {
            var existing=findByRequest(input.requestId(),user);
            if(existing.isEmpty()) throw new AuthException("생성 요청을 다시 시도해 주세요.",409);
            return existing.getFirst();
        }
        worker.enqueue(retryId,user);
        return find(retryId,user);
    }

    @DeleteMapping("/generations/{id}")
    public Map<String,Object> cancel(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        int canceled=db.update("update generation_jobs set status='CANCELED',completed_at=current_timestamp,error_code=null where id=? and user_id=? and status in ('PENDING','RUNNING')",id,user);
        if(canceled==1) return Map.of("canceled",true,"status","CANCELED");
        var status=db.queryForList("select status from generation_jobs where id=? and user_id=?",String.class,id,user);
        if(status.isEmpty()) throw new AuthException("생성 작업을 찾을 수 없습니다.",404);
        return Map.of("canceled",false,"status",status.getFirst());
    }

    @PutMapping("/artifacts/{id}")
    public Generation updateArtifact(Authentication auth,@PathVariable String id,@Valid @RequestBody UpdateArtifact input) {
        long user=owner(auth);
        var kinds=db.queryForList("select kind from learning_artifacts where id=? and user_id=?",String.class,id,user);
        if(kinds.isEmpty()) throw new AuthException("학습 자료를 찾을 수 없습니다.",404);
        if("MIND_MAP".equals(kinds.getFirst())) validateMindMap(input.content());
        int updated=db.update("update learning_artifacts set title=?,content=?,version=version+1 where id=? and user_id=? and version=?",
                input.title().strip(),input.content(),id,user,input.version());
        if(updated!=1) throw new AuthException("다른 화면에서 수정된 학습 자료입니다. 다시 열어 주세요.",409);
        return db.queryForObject(baseSelect()+" where a.id=? and a.user_id=?",(row,index)->map(row),id,user);
    }

    private void validateMindMap(String content) {
        try { int[] count={0}; validateMindMapNode(json.readTree(content),0,count); }
        catch(AuthException error) { throw error; }
        catch(Exception error) { throw new AuthException("마인드맵 JSON 형식을 확인해 주세요.",400); }
    }
    private void validateMindMapNode(JsonNode node,int depth,int[] count) {
        if(node==null || !node.isObject() || depth>10 || ++count[0]>200 || !node.path("label").isString()
                || node.path("label").asText().isBlank() || node.path("label").asText().length()>200)
            throw new AuthException("마인드맵은 10단계·200개 항목 이내의 label/children 구조여야 합니다.",400);
        JsonNode children=node.get("children");
        if(children==null)return;
        if(!children.isArray())throw new AuthException("마인드맵 children은 목록이어야 합니다.",400);
        children.forEach(child->validateMindMapNode(child,depth+1,count));
    }

    private NoteVersion requireNote(String noteId,long user) {
        var notes=db.query("select version,title,body from notes n where id=? and user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)",(row,index) -> new NoteVersion(row.getLong("version"),row.getString("title"),row.getString("body")),noteId,user);
        if (notes.isEmpty()) throw new AuthException("노트를 찾을 수 없습니다.",404);
        return notes.getFirst();
    }
    private Generation find(String id,long user) {
        return db.queryForObject(baseSelect()+" where j.id=? and j.user_id=?",
                (row,index) -> map(row),id,user);
    }
    private List<Generation> findByRequest(String requestId,long user) {
        return db.query(baseSelect()+" where j.request_id=? and j.user_id=?",(row,index)->map(row),requestId,user);
    }
    private String baseSelect() {
        return "select j.*,a.id artifact_id,a.title artifact_title,a.content artifact_content,coalesce(a.version,0) artifact_version,(select count(*) from generation_job_sources s where s.job_id=j.id) attachment_count from generation_jobs j left join learning_artifacts a on a.job_id=j.id and a.user_id=j.user_id";
    }
    private List<AttachmentSource> requireAttachments(List<String> ids,String noteId,long user) {
        if(ids==null || ids.isEmpty()) return List.of();
        if(new HashSet<>(ids).size()!=ids.size()) throw new AuthException("같은 자료를 중복 선택할 수 없습니다.",400);
        var result=new ArrayList<AttachmentSource>();
        for(String id:ids) {
            var rows=db.query("select id,original_name,extracted_text from attachments where id=? and note_id=? and user_id=? and analysis_status='TEXT_READY' and extracted_text is not null",
                    (row,index)->new AttachmentSource(row.getString("id"),row.getString("original_name"),row.getString("extracted_text")),id,noteId,user);
            if(rows.isEmpty()) throw new AuthException("분석이 완료된 현재 노트의 자료만 포함할 수 있습니다.",400);
            result.add(rows.getFirst());
        }
        return result;
    }
    private void requireRegenerationSource(String sourceJobId,String noteId,String kind,long user) {
        if(sourceJobId==null) return;
        var originals=db.query("select note_id,kind from generation_jobs where id=? and user_id=? and status='COMPLETED'",
                (row,index)->new RegenerationSource(row.getString("note_id"),row.getString("kind")),sourceJobId,user);
        if(originals.isEmpty()) throw new AuthException("새 버전을 만들 원본 결과를 찾을 수 없습니다.",404);
        var original=originals.getFirst();
        if(!noteId.equals(original.noteId()) || !kind.equals(original.kind()))
            throw new AuthException("같은 노트와 같은 자료 유형에서만 새 버전을 만들 수 있습니다.",400);
    }    private void requireWithinLimits(long user) {
        Integer running=db.queryForObject("select count(*) from generation_jobs where user_id=? and status='RUNNING'",Integer.class,user);
        Integer pending=db.queryForObject("select count(*) from generation_jobs where user_id=? and status='PENDING'",Integer.class,user);
        Integer daily=db.queryForObject("select count(*) from generation_jobs where user_id=? and created_at >= current_date",Integer.class,user);
        if(running!=null && running>=1) throw new AuthException("이미 실행 중인 생성 작업이 있습니다. 완료 후 다시 시도해 주세요.",429);
        if(pending!=null && pending>=5) throw new AuthException("대기 중인 생성 작업이 많습니다. 완료 후 다시 시도해 주세요.",429);
        if(daily!=null && daily>=30) throw new AuthException("오늘의 생성 한도(30회)에 도달했습니다.",429);
    }
    private List<String> locations(String text) {
        if(text==null || text.isBlank()) return List.of();
        var result=new ArrayList<String>();
        Matcher matcher=LOCATION_MARKER.matcher(text);
        while(matcher.find() && result.size()<40) result.add(matcher.group(1));
        return result;
    }
    private Generation map(ResultSet row) throws SQLException {
        var completed=row.getTimestamp("completed_at");
        return new Generation(row.getString("id"),row.getString("note_id"),row.getString("kind"),row.getString("status"),row.getLong("source_note_version"),row.getString("model"),row.getBoolean("mock_result"),row.getString("error_code"),row.getTimestamp("created_at").toInstant().toString(),completed==null?null:completed.toInstant().toString(),row.getInt("attachment_count"),row.getString("artifact_id"),row.getString("artifact_title"),row.getString("artifact_content"),row.getLong("artifact_version"),row.getString("regenerate_from_job_id"));
    }
    private record NoteVersion(long version,String title,String body) {}
    private record RetrySource(String noteId,String kind,long version,String title,String body,String model) {}
    private record AttachmentSource(String id,String name,String text) {}
    private record RegenerationSource(String noteId,String kind) {}
    private record SourceHeader(long noteVersion,String noteTitle) {}
}
