package kr.omong.studyspace.study;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@RestController
@RequestMapping("/api/account")
public class AccountExportController {
    private final JdbcTemplate db;
    private final AttachmentStorage attachments;
    private final RecordingStorage recordings;

    public AccountExportController(JdbcTemplate db, AttachmentStorage attachments, RecordingStorage recordings) {
        this.db=db; this.attachments=attachments; this.recordings=recordings;
    }

    record NoteRow(String id,String semester,String course,String title,String body) {}
    record FileRow(String noteId,String id,String name,String key) {}
    record ArtifactRow(String noteId,String id,String kind,String title,String content) {}
    record RecordingRow(String noteId,String id,String title,String mime,String key) {}

    @GetMapping(value="/export",produces="application/zip")
    public ResponseEntity<StreamingResponseBody> export(Authentication authentication) {
        long user=Long.parseLong(authentication.getName());
        List<NoteRow> notes=db.query("select n.id,c.semester,c.name course_name,n.title,n.body from notes n join courses c on c.id=n.course_id where n.user_id=? order by c.semester,c.name,n.updated_at",
                (row,index)->new NoteRow(row.getString("id"),row.getString("semester"),row.getString("course_name"),row.getString("title"),row.getString("body")),user);
        List<FileRow> files=db.query("select a.note_id,a.id,a.original_name,a.storage_key from attachments a where a.user_id=? order by a.created_at",
                (row,index)->new FileRow(row.getString("note_id"),row.getString("id"),row.getString("original_name"),row.getString("storage_key")),user);
        List<ArtifactRow> artifacts=db.query("select note_id,id,kind,title,content from learning_artifacts where user_id=? order by created_at",
                (row,index)->new ArtifactRow(row.getString("note_id"),row.getString("id"),row.getString("kind"),row.getString("title"),row.getString("content")),user);
        List<RecordingRow> audio=db.query("select note_id,id,title,mime_type,storage_key from recordings where user_id=? and status='READY' order by created_at",
                (row,index)->new RecordingRow(row.getString("note_id"),row.getString("id"),row.getString("title"),row.getString("mime_type"),row.getString("storage_key")),user);
        StreamingResponseBody body=output->{
            try(ZipOutputStream zip=new ZipOutputStream(output,StandardCharsets.UTF_8)) {
                put(zip,"README.txt",("StudySpace 데이터 내보내기\n노트 "+notes.size()+"개 · 첨부 "+files.size()+"개 · AI 산출물 "+artifacts.size()+"개 · 녹음 "+audio.size()+"개\n").getBytes(StandardCharsets.UTF_8));
                for(NoteRow note:notes) put(zip,notePath(note),markdown(note).getBytes(StandardCharsets.UTF_8));
                for(FileRow file:files) try(InputStream input=attachments.open(file.key())) { put(zip,"attachments/"+safe(file.noteId())+"/"+safe(file.name())+"-"+shortId(file.id()),input); }
                for(ArtifactRow item:artifacts) put(zip,"artifacts/"+safe(item.noteId())+"/"+safe(item.kind()+"-"+item.title())+"-"+shortId(item.id())+".md",item.content().getBytes(StandardCharsets.UTF_8));
                for(RecordingRow item:audio) try(InputStream input=recordings.resource(item.key()).getInputStream()) { put(zip,"recordings/"+safe(item.noteId())+"/"+safe(item.title())+"-"+shortId(item.id())+extension(item.mime()),input); }
            }
        };
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/zip"))
                .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=studyspace-export.zip")
                .header(HttpHeaders.CACHE_CONTROL,"no-store").body(body);
    }

    private static String notePath(NoteRow note) { return "notes/"+safe(note.semester())+"/"+safe(note.course())+"/"+safe(note.title())+"-"+shortId(note.id())+".md"; }
    private static String markdown(NoteRow note) { return "---\ntitle: \""+note.title().replace("\\","\\\\").replace("\"","\\\"")+"\"\nsemester: \""+note.semester().replace("\"","\\\"")+"\"\ncourse: \""+note.course().replace("\"","\\\"")+"\"\n---\n"+note.body(); }
    private static String safe(String value) { String result=value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_").strip(); return result.isBlank()?"untitled":result; }
    private static String shortId(String id) { return id.substring(0,Math.min(8,id.length())); }
    private static String extension(String mime) { return mime.contains("mp4")?".m4a":mime.contains("ogg")?".ogg":".webm"; }
    private static void put(ZipOutputStream zip,String name,byte[] bytes) throws java.io.IOException { zip.putNextEntry(new ZipEntry(name));zip.write(bytes);zip.closeEntry(); }
    private static void put(ZipOutputStream zip,String name,InputStream input) throws java.io.IOException { zip.putNextEntry(new ZipEntry(name));input.transferTo(zip);zip.closeEntry(); }
}
