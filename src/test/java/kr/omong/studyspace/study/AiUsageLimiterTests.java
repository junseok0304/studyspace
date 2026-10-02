package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDate;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@SpringBootTest
class AiUsageLimiterTests {
    @Autowired JdbcTemplate db;
    @Autowired AiUsageLimiter limiter;
    private long userId;

    @AfterEach
    void cleanup() {
        if (userId != 0) db.update("delete from users where id=?", userId);
    }

    @Test
    void reservesAtMostThirtyOperationsPerAccountAndDay() {
        String email = "ai-limit-" + UUID.randomUUID() + "@example.com";
        db.update("insert into users(email,password_hash,nickname) values(?,?,?)",
                email, "test-hash", "AI limit test");
        userId = db.queryForObject("select id from users where email=?", Long.class, email);
        LocalDate today = LocalDate.of(2026, 10, 2);

        for (int i = 0; i < AiUsageLimiter.DAILY_LIMIT; i++) limiter.requireAvailable(userId, today);

        assertEquals(30, db.queryForObject("select request_count from ai_usage_daily where user_id=? and usage_date=?",
                Integer.class, userId, today));
        assertThrows(AuthException.class, () -> limiter.requireAvailable(userId, today));
        limiter.requireAvailable(userId, today.plusDays(1));
        assertEquals(1, db.queryForObject("select request_count from ai_usage_daily where user_id=? and usage_date=?",
                Integer.class, userId, today.plusDays(1)));
    }
}
