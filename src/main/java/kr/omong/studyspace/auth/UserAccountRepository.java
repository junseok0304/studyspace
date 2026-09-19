package kr.omong.studyspace.auth;

import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

@Repository
public class UserAccountRepository {
    private final JdbcTemplate jdbc;

    public UserAccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<UserAccount> findByEmail(String email) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                    "select id, email, password_hash, nickname, email_verified, onboarding_completed, created_at from users where email = ?",
                    this::map, email));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public Optional<UserAccount> findById(long id) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                    "select id, email, password_hash, nickname, email_verified, onboarding_completed, created_at from users where id = ?",
                    this::map, id));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public Optional<UserAccount> findByProvider(String provider, String providerUserId) {
        try {
            return Optional.ofNullable(jdbc.queryForObject(
                    "select u.id, u.email, u.password_hash, u.nickname, u.email_verified, u.onboarding_completed, u.created_at from users u join social_identities s on s.user_id = u.id where s.provider = ? and s.provider_user_id = ?",
                    this::map, provider, providerUserId));
        } catch (EmptyResultDataAccessException e) {
            return Optional.empty();
        }
    }

    public UserAccount create(String email, String passwordHash, String nickname, boolean emailVerified) {
        jdbc.update("insert into users(email, password_hash, nickname, email_verified, onboarding_completed) values (?, ?, ?, ?, false)",
                email, passwordHash, nickname, emailVerified);
        return findByEmail(email).orElseThrow();
    }

    public void addProvider(long userId, String provider, String providerUserId, String providerEmail) {
        jdbc.update("insert into social_identities(user_id, provider, provider_user_id, provider_email) values (?, ?, ?, ?)",
                userId, provider, providerUserId, providerEmail);
    }

    public void saveVerificationToken(long userId, String token, Instant expiresAt) {
        jdbc.update("insert into email_verification_tokens(user_id, token_hash, expires_at) values (?, ?, ?)",
                userId, token, expiresAt);
    }

    public boolean verifyToken(String token) {
        int updated = jdbc.update("update users set email_verified = true where id = (select user_id from email_verification_tokens where token_hash = ? and used_at is null and expires_at > current_timestamp)", token);
        if (updated == 0) return false;
        jdbc.update("update email_verification_tokens set used_at = current_timestamp where token_hash = ?", token);
        return true;
    }

    private UserAccount map(ResultSet rs, int rowNum) throws SQLException {
        return new UserAccount(
                rs.getLong("id"),
                rs.getString("email"),
                rs.getString("password_hash"),
                rs.getString("nickname"),
                rs.getBoolean("email_verified"),
                rs.getBoolean("onboarding_completed"),
                rs.getTimestamp("created_at").toInstant());
    }
}
