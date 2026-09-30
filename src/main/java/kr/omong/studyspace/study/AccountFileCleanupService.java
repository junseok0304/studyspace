package kr.omong.studyspace.study;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AccountFileCleanupService {
    private final JdbcTemplate db; private final AttachmentStorage attachments; private final RecordingStorage recordings;
    public AccountFileCleanupService(JdbcTemplate db,AttachmentStorage attachments,RecordingStorage recordings) { this.db=db;this.attachments=attachments;this.recordings=recordings; }

    @PostConstruct public void resume() { cleanupPending(); }

    public void cleanupPending() {
        var rows=db.queryForList("select id,kind,user_id,item_key from account_file_cleanup where completed_at is null order by id");
        for(var row:rows) {
            long id=((Number)row.get("id")).longValue();
            try {
                if("ATTACHMENT".equals(row.get("kind"))) attachments.delete((String)row.get("item_key"));
                else recordings.delete(((Number)row.get("user_id")).longValue(),(String)row.get("item_key"));
                db.update("update account_file_cleanup set completed_at=current_timestamp,attempts=attempts+1,last_error=null where id=?",id);
            } catch(Exception error) {
                db.update("update account_file_cleanup set attempts=attempts+1,last_error=? where id=?",error.getClass().getSimpleName(),id);
            }
        }
    }
}
