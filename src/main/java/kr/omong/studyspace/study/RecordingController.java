package kr.omong.studyspace.study;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRange;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class RecordingController {
    private final JdbcTemplate db; private final RecordingStorage storage; private final ObjectMapper json; private final TransactionTemplate tx;private final StorageQuotaService quota;private final AuthSupport authSupport;
    public RecordingController(JdbcTemplate db,RecordingStorage storage,ObjectMapper json,TransactionTemplate tx,StorageQuotaService quota,AuthSupport authSupport) { this.db=db; this.storage=storage; this.json=json; this.tx=tx;this.quota=quota;this.authSupport=authSupport; }

    public record Create(@NotBlank @Size(max=100) String title,@NotNull @Pattern(regexp="audio/(webm|ogg|mp4)(;.*)?") String mimeType) {}
    public record Finish(@DecimalMin("0.1") @DecimalMax("3600.0") double durationSeconds) {}
    public record Waveform(@NotNull @Size(min=1,max=6000) List<@DecimalMin("0.0") @DecimalMax("1.0") Double> peaks,
                           @DecimalMin("0.1") @DecimalMax("3600.0") Double durationSeconds) {}
    public record Rename(@NotBlank @Size(max=100) String title) {}
    public record NoteLink(@NotBlank String noteId) {}
    public record Recording(String id,String noteId,String noteTitle,String courseId,String title,String status,String mimeType,Double durationSeconds,long size,int chunkCount,List<Double> waveform,String createdAt,String completedAt) {}

    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }
    private void requireNote(String noteId,long user) { authSupport.requireNote(noteId,user); }

    @GetMapping("/notes/{noteId}/recordings")
    public List<Recording> list(Authentication auth,@PathVariable String noteId) {
        long user=owner(auth); requireNote(noteId,user);
        String courseId=db.queryForObject("select course_id from notes where id=? and user_id=?",String.class,noteId,user);
        return listForCourse(courseId,user);
    }

    @GetMapping("/courses/{courseId}/recordings")
    public List<Recording> listForCourse(Authentication auth,@PathVariable String courseId) {
        long user=owner(auth); authSupport.requireCourse(courseId,user);
        return listForCourse(courseId,user);
    }

    private List<Recording> listForCourse(String courseId,long user) {
        return db.query("select r.*,n.title as linked_note_title from recordings r left join notes n on n.id=r.note_id where r.course_id=? and r.user_id=? order by r.created_at desc",(row,index)->map(row),courseId,user);
    }

    @PostMapping("/notes/{noteId}/recordings")
    @ResponseStatus(HttpStatus.CREATED)
    public Recording create(Authentication auth,@PathVariable String noteId,@Valid @RequestBody Create input) {
        long user=owner(auth); requireNote(noteId,user);
        String courseId=db.queryForObject("select course_id from notes where id=? and user_id=?",String.class,noteId,user);
        Integer active=db.queryForObject("select count(*) from recordings where user_id=? and status='RECORDING'",Integer.class,user);
        if(active!=null && active>0) throw new AuthException("이미 진행 중인 녹음이 있습니다.",409);
        String id=UUID.randomUUID().toString();
        db.update("insert into recordings(id,note_id,course_id,user_id,title,status,mime_type) values(?,null,?,?,?,'RECORDING',?)",id,courseId,user,input.title().strip(),input.mimeType());
        return find(id,user);
    }

    @PostMapping(value="/recordings/{id}/chunks",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String,Object> chunk(Authentication auth,@PathVariable String id,@RequestParam int sequence,@RequestPart("chunk") MultipartFile file) throws Exception {
        long user=owner(auth); if(sequence<0 || sequence>7200) throw new AuthException("녹음 조각 순서가 올바르지 않습니다.",400);quota.requireAvailable(user,file==null?0:file.getSize());
        var rows=db.query("select next_sequence from recordings where id=? and user_id=? and status='RECORDING'",(row,index)->row.getInt("next_sequence"),id,user);
        if(rows.isEmpty()) throw new AuthException("진행 중인 녹음을 찾을 수 없습니다.",404);
        int expected=rows.getFirst();
        if(sequence!=expected) throw new AuthException("녹음 조각 순서가 맞지 않습니다.",409);
        var stored=storage.storeChunk(user,id,sequence,file);
        try { tx.executeWithoutResult(status -> {
            db.update("insert into recording_chunks(recording_id,sequence_number,size_bytes,sha256) values(?,?,?,?)",id,sequence,stored.size(),stored.sha256());
            if(db.update("update recordings set next_sequence=next_sequence+1,size_bytes=size_bytes+? where id=? and user_id=? and status='RECORDING' and next_sequence=?",stored.size(),id,user,sequence)!=1)
                throw new AuthException("녹음 조각을 다시 전송해 주세요.",409);
        }); } catch(RuntimeException error) { storage.deleteChunk(user,id,sequence); throw error; }
        return Map.of("accepted",true,"nextSequence",sequence+1);
    }

    @PostMapping("/recordings/{id}/finish")
    public Recording finish(Authentication auth,@PathVariable String id,@Valid @RequestBody Finish input) throws Exception {
        long user=owner(auth);
        var rows=db.query("select next_sequence,mime_type from recordings where id=? and user_id=? and status='RECORDING'",(row,index)->Map.of("chunks",row.getInt("next_sequence"),"mime",row.getString("mime_type")),id,user);
        if(rows.isEmpty()) throw new AuthException("진행 중인 녹음을 찾을 수 없습니다.",404);
        int chunks=(Integer)rows.getFirst().get("chunks"); if(chunks<1) throw new AuthException("저장된 녹음 내용이 없습니다.",409);
        String mime=(String)rows.getFirst().get("mime"); String extension=mime.contains("mp4")?"m4a":mime.contains("ogg")?"ogg":"webm";
        var file=storage.assemble(user,id,chunks,extension);
        db.update("update recordings set status='READY',storage_key=?,duration_seconds=?,size_bytes=?,waveform_json=null,completed_at=current_timestamp where id=? and user_id=? and status='RECORDING'",file.storageKey(),input.durationSeconds(),file.size(),id,user);
        return find(id,user);
    }

    @PostMapping("/recordings/{id}/waveform")
    public Recording waveform(Authentication auth,@PathVariable String id,@Valid @RequestBody Waveform input) throws Exception {
        long user=owner(auth);
        int updated=input.durationSeconds()==null
                ? db.update("update recordings set waveform_json=? where id=? and user_id=? and status='READY'",json.writeValueAsString(input.peaks()),id,user)
                : db.update("update recordings set waveform_json=?,duration_seconds=? where id=? and user_id=? and status='READY'",json.writeValueAsString(input.peaks()),input.durationSeconds(),id,user);
        if(updated!=1)
            throw new AuthException("파형을 저장할 녹음을 찾을 수 없습니다.",404);
        return find(id,user);
    }

    @PatchMapping("/recordings/{id}")
    public Recording rename(Authentication auth,@PathVariable String id,@Valid @RequestBody Rename input) {
        long user=owner(auth); if(db.update("update recordings set title=? where id=? and user_id=?",input.title().strip(),id,user)!=1) throw new AuthException("녹음을 찾을 수 없습니다.",404); return find(id,user);
    }

    @PatchMapping("/recordings/{id}/note")
    public Recording linkNote(Authentication auth,@PathVariable String id,@Valid @RequestBody NoteLink input) {
        long user=owner(auth);
        int updated=db.update("update recordings set note_id=? where id=? and user_id=? and status='READY' and exists(select 1 from notes n where n.id=? and n.user_id=? and n.course_id=recordings.course_id and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id))",input.noteId(),id,user,input.noteId(),user);
        if(updated!=1) {
            Integer owned=db.queryForObject("select count(*) from recordings where id=? and user_id=?",Integer.class,id,user);
            if(owned==null || owned==0) throw new AuthException("녹음을 찾을 수 없습니다.",404);
            throw new AuthException("완료된 녹음은 같은 과목의 노트에만 연결할 수 있습니다.",409);
        }
        return find(id,user);
    }

    @GetMapping("/recordings/{id}/content")
    public ResponseEntity<ResourceRegion> content(Authentication auth,@PathVariable String id,
                                     @RequestHeader(value=HttpHeaders.RANGE,required=false) String rangeHeader) throws Exception {
        long user=owner(auth); var rows=db.query("select storage_key,mime_type from recordings where id=? and user_id=? and status='READY'",(row,index)->Map.of("key",row.getString("storage_key"),"mime",row.getString("mime_type")),id,user);
        if(rows.isEmpty()) throw new AuthException("재생할 녹음을 찾을 수 없습니다.",404); var item=rows.getFirst(); Resource resource=storage.resource((String)item.get("key"));
        MediaType mediaType=MediaType.parseMediaType((String)item.get("mime"));
        if(rangeHeader==null || rangeHeader.isBlank()) {
            long length=resource.contentLength();
            return ResponseEntity.ok().header(HttpHeaders.ACCEPT_RANGES,"bytes").contentLength(length).contentType(mediaType).body(new ResourceRegion(resource,0,length));
        }
        List<HttpRange> ranges;
        try { ranges=HttpRange.parseRanges(rangeHeader); }
        catch(IllegalArgumentException error) { throw new AuthException("요청한 녹음 구간이 올바르지 않습니다.",416); }
        if(ranges.size()!=1) throw new AuthException("한 번에 하나의 녹음 구간만 재생할 수 있습니다.",416);
        long length=resource.contentLength();
        ResourceRegion region;
        try { region=ranges.getFirst().toResourceRegion(resource); }
        catch(IllegalArgumentException error) { throw new AuthException("요청한 녹음 구간이 파일 범위를 벗어났습니다.",416); }
        long start=region.getPosition(),end=start+region.getCount()-1;
        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).header(HttpHeaders.ACCEPT_RANGES,"bytes")
                .header(HttpHeaders.CONTENT_RANGE,"bytes "+start+"-"+end+"/"+length).contentLength(region.getCount()).contentType(mediaType).body(region);
    }

    @DeleteMapping("/recordings/{id}")
    public Map<String,Boolean> delete(Authentication auth,@PathVariable String id) throws Exception {
        long user=owner(auth); Integer count=db.queryForObject("select count(*) from recordings where id=? and user_id=?",Integer.class,id,user); if(count==null || count!=1) throw new AuthException("녹음을 찾을 수 없습니다.",404);
        storage.delete(user,id); db.update("delete from recordings where id=? and user_id=?",id,user); return Map.of("deleted",true);
    }

    private Recording find(String id,long user) { return db.queryForObject("select r.*,n.title as linked_note_title from recordings r left join notes n on n.id=r.note_id where r.id=? and r.user_id=?",(row,index)->map(row),id,user); }
    private Recording map(ResultSet row) throws SQLException {
        List<Double> waveform=List.of(); String raw=row.getString("waveform_json");
        if(raw!=null) try { waveform=json.readValue(raw,new TypeReference<>(){}); } catch(Exception ignored) {}
        Double duration=row.getObject("duration_seconds")==null?null:row.getDouble("duration_seconds"); var completed=row.getTimestamp("completed_at");
        return new Recording(row.getString("id"),row.getString("note_id"),row.getString("linked_note_title"),row.getString("course_id"),row.getString("title"),row.getString("status"),row.getString("mime_type"),duration,row.getLong("size_bytes"),row.getInt("next_sequence"),waveform,row.getTimestamp("created_at").toInstant().toString(),completed==null?null:completed.toInstant().toString());
    }
}
