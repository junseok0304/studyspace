package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.ZoneId;

/** Reserves one account-level AI operation for the current Korea calendar day. */
@Component
public class AiUsageLimiter {
    public static final int DAILY_LIMIT = 30;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Seoul");
    private static final String LIMIT_MESSAGE = "오늘 AI 기능 사용 한도(30회)에 도달했습니다. 내일 다시 이용해 주세요.";

    private final JdbcTemplate db;
    private final TransactionTemplate tx;

    public AiUsageLimiter(JdbcTemplate db, org.springframework.transaction.PlatformTransactionManager manager) {
        this.db = db;
        this.tx = new TransactionTemplate(manager);
    }

    public void requireAvailable(long userId) {
        requireAvailable(userId, LocalDate.now(BUSINESS_ZONE));
    }

    void requireAvailable(long userId, LocalDate date) {
        tx.executeWithoutResult(status -> {
            try {
                db.update("insert into ai_usage_daily(user_id,usage_date,request_count) values(?,?,1)", userId, date);
                return;
            } catch (DuplicateKeyException ignored) {
                // A concurrent request may have created today's row.
            }
            int updated = db.update("update ai_usage_daily set request_count=request_count+1 "
                            + "where user_id=? and usage_date=? and request_count < ?",
                    userId, date, DAILY_LIMIT);
            if (updated != 1) throw new AuthException(LIMIT_MESSAGE, 429);
        });
    }
}
