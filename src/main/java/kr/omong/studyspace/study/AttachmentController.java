package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

@RestController
@RequestMapping("/api")
public class AttachmentController {
    private final JdbcTemplate db; private final AttachmentStorage storage; private final AttachmentAnalysisWorker analysisWorker;private final StorageQuotaService quota;private final AuthSupport authSupport;
    private final org.springframework.transaction.support.TransactionTemplate tx;
    public AttachmentController(JdbcTemplate db, AttachmentStorage storage,AttachmentAnalysisWorker analysisWorker,StorageQuotaService quota,
                                org.springframework.transaction.PlatformTransactionManager manager,AuthSupport authSupport) {
        this.db=db; this.storage=storage; this.analysisWorker=analysisWorker;this.quota=quota;this.tx=new org.springframework.transaction.support.TransactionTemplate(manager);this.authSupport=authSupport;
    }
    public record Attachment(String id,String noteId,String originalName,String mediaType,long size,String sha256,String analysisStatus,int extractedLength,String analysisErrorCode,String analyzedAt,boolean reusedAnalysis,String summaryStatus,String summaryText,String summaryErrorCode,String createdAt) {}
    public record Analysis(String id,String originalName,String extractedText,String analyzedAt) {}
    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }
    private void requireNote(String noteId,long user) { authSupport.requireNote(noteId,user); }
    private Attachment row(java.sql.ResultSet r) throws java.sql.SQLException {
        var analyzed=r.getTimestamp("analyzed_at"); String extracted=r.getString("extracted_text");
        return new Attachment(r.getString("id"),r.getString("note_id"),r.getString("original_name"),r.getString("media_type"),r.getLong("size_bytes"),r.getString("sha256"),r.getString("analysis_status"),extracted==null?0:extracted.length(),r.getString("analysis_error_code"),analyzed==null?null:analyzed.toInstant().toString(),r.getBoolean("analysis_reused"),r.getString("summary_status"),r.getString("summary_text"),r.getString("summary_error_code"),r.getTimestamp("created_at").toInstant().toString());
    }
    @GetMapping("/notes/{noteId}/attachments")
    public List<Attachment> list(Authentication auth,@PathVariable String noteId) { long user=owner(auth); requireNote(noteId,user); var rows=db.query("select id from attachments where note_id=? and user_id=? and analysis_status='TEXT_READY' and summary_status='NOT_SUMMARIZED'",(r,n)->r.getString("id"),noteId,user); rows.forEach(id->analysisWorker.startSummary(id,user)); return db.query("select * from attachments where note_id=? and user_id=? order by created_at,id",(r,n)->row(r),noteId,user); }
    @PostMapping(value="/notes/{noteId}/attachments",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Attachment upload(Authentication auth,@PathVariable String noteId,@RequestPart("file") MultipartFile file) throws IOException {
        long user=owner(auth); requireNote(noteId,user);        return tx.execute(status -> {
            try {
                db.queryForObject("select id from users where id=? for update",Long.class,user);
                quota.requireAvailable(user,file==null?0:file.getSize());
                String id=UUID.randomUUID().toString();
                var stored=storage.store(user,id,file); String name=AttachmentStorage.safeName(file.getOriginalFilename());
                try {
                    var reusable=db.query("select extracted_text from attachments where user_id=? and sha256=? and extension=? and analysis_status='TEXT_READY' and analysis_version=1 order by analyzed_at desc limit 1",(row,index)->row.getString("extracted_text"),user,stored.sha256(),stored.extension());
                    if(reusable.isEmpty()) db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256,analysis_status) values(?,?,?,?,?,?,?,?,?,'NOT_ANALYZED')",id,noteId,user,name,stored.storageKey(),stored.mediaType(),stored.extension(),stored.size(),stored.sha256());
                    else db.update("insert into attachments(id,note_id,user_id,original_name,storage_key,media_type,extension,size_bytes,sha256,analysis_status,extracted_text,analyzed_at,analysis_reused) values(?,?,?,?,?,?,?,?,?,'TEXT_READY',?,current_timestamp,true)",id,noteId,user,name,stored.storageKey(),stored.mediaType(),stored.extension(),stored.size(),stored.sha256(),reusable.getFirst());
                } catch (RuntimeException error) { storage.delete(stored.storageKey()); throw error; }
                return db.queryForObject("select * from attachments where id=? and user_id=?",(r,n)->row(r),id,user);
            } catch (IOException error) {
                throw new RuntimeException(error);
            }
        });
    }
    @DeleteMapping("/attachments/{id}")
    public Map<String,Boolean> delete(Authentication auth,@PathVariable String id) throws IOException {
        long user=owner(auth); var rows=db.queryForList("select storage_key from attachments where id=? and user_id=?",id,user); if(rows.isEmpty()) throw new AuthException("첨부 파일을 찾을 수 없습니다.",404);
        storage.delete((String)rows.getFirst().get("storage_key")); db.update("delete from attachments where id=? and user_id=?",id,user); return Map.of("deleted",true);
    }
    @GetMapping("/attachments/{id}/content")
    public ResponseEntity<InputStreamResource> content(Authentication auth,@PathVariable String id) throws IOException {
        long user=owner(auth); var rows=db.query("select storage_key,media_type,size_bytes,original_name from attachments where id=? and user_id=?",(r,n)->Map.of("storageKey",r.getString("storage_key"),"mediaType",r.getString("media_type"),"size",r.getLong("size_bytes"),"name",r.getString("original_name")),id,user);
        if(rows.isEmpty()) throw new AuthException("첨부 파일을 찾을 수 없습니다.",404); var item=rows.getFirst();
        InputStreamResource resource; try { resource=new InputStreamResource(storage.open((String)item.get("storageKey"))); } catch (IOException error) { throw new AuthException("첨부 파일을 읽을 수 없습니다.",410); }
        String filename=ContentDisposition.attachment().filename((String)item.get("name"),StandardCharsets.UTF_8).build().toString();
        return ResponseEntity.ok().contentType(MediaType.parseMediaType((String)item.get("mediaType"))).contentLength((Long)item.get("size")).header(HttpHeaders.CONTENT_DISPOSITION,filename).body(resource);
    }
    @GetMapping("/attachments/{id}/analysis")
    public Analysis analysis(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        var rows=db.query("select original_name,extracted_text,analyzed_at from attachments where id=? and user_id=?",
                (r,n)->new Analysis(id,r.getString("original_name"),r.getString("extracted_text"),r.getTimestamp("analyzed_at")==null?null:r.getTimestamp("analyzed_at").toInstant().toString()),id,user);
        if(rows.isEmpty()) throw new AuthException("첨부 파일을 찾을 수 없습니다.",404);
        Analysis result=rows.getFirst();
        if(result.extractedText()==null) throw new AuthException("분석이 완료된 자료만 내용을 확인할 수 있습니다.",409);
        return result;
    }

    @PostMapping("/attachments/{id}/analysis")
    public Attachment analyze(Authentication auth,@PathVariable String id) throws IOException {
        long user=owner(auth);
        var rows=db.query("select storage_key,extension from attachments where id=? and user_id=?",(r,n)->Map.of("storageKey",r.getString("storage_key"),"extension",r.getString("extension")),id,user);
        if(rows.isEmpty()) throw new AuthException("첨부 파일을 찾을 수 없습니다.",404);
        analysisWorker.start(id,user);
        return db.queryForObject("select * from attachments where id=? and user_id=?",(r,n)->row(r),id,user);
    }

    @PostMapping("/attachments/{id}/summary")
    public Attachment summarize(Authentication auth,@PathVariable String id) {
        long user=owner(auth);
        if(db.queryForObject("select count(*) from attachments where id=? and user_id=? and analysis_status='TEXT_READY'",Integer.class,id,user)!=1)
            throw new AuthException("분석이 완료된 자료만 요약할 수 있습니다.",409);
        analysisWorker.startSummary(id,user);
        return db.queryForObject("select * from attachments where id=? and user_id=?",(r,n)->row(r),id,user);
    }
}
