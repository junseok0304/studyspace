package kr.omong.studyspace.study;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class UsageRecorder {
    private final JdbcTemplate db;
    public UsageRecorder(JdbcTemplate db) { this.db = db; }

    public void record(long userId, String kind, String model, long promptTokens, long outputTokens) {
        db.update("insert into usage_records(user_id,kind,model,prompt_tokens,output_tokens) values(?,?,?,?,?)",
                userId, kind, model, promptTokens, outputTokens);
    }
}
