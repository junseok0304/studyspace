package kr.omong.studyspace.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthService {
    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private final UserAccountRepository users;
    private final PasswordEncoder passwordEncoder;
    private final boolean requireEmailVerification;
    private final PasswordResetMailer resetMailer;
    private final SecureRandom secureRandom = new SecureRandom();

    public AuthService(UserAccountRepository users,
                       PasswordEncoder passwordEncoder,
                       @Value("${studyspace.auth.require-email-verification:false}") boolean requireEmailVerification,
                       PasswordResetMailer resetMailer) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.requireEmailVerification = requireEmailVerification;
        this.resetMailer = resetMailer;
    }

    @Transactional
    public AuthModels.SignupResponse signup(AuthModels.SignupRequest request, String baseUrl) {
        requireConsent(request.termsAccepted(), request.privacyAccepted());
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        checkRateLimit("signup:"+email, 10, Duration.ofHours(1));
        String nickname = request.nickname().trim();
        if (users.findByEmail(email).isPresent()) {
            throw new AuthException("이미 가입된 이메일입니다.", 409);
        }
        try {
            UserAccount user = users.create(email, passwordEncoder.encode(request.password()), nickname, !requireEmailVerification);
            users.saveConsent(user.id());
            String verificationUrl = null;
            if (requireEmailVerification) {
                String rawToken = randomToken();
                users.saveVerificationToken(user.id(), sha256(rawToken), Instant.now().plus(Duration.ofHours(24)));
                verificationUrl = baseUrl + "/api/auth/verify-email?token=" + rawToken;
            }
            return new AuthModels.SignupResponse(user.response(), requireEmailVerification, verificationUrl);
        } catch (DuplicateKeyException e) {
            throw new AuthException("이미 가입된 이메일입니다.", 409);
        }
    }

    public UserAccount authenticate(AuthModels.LoginRequest request) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        checkRateLimit("login:"+email, 8, Duration.ofMinutes(15));
        UserAccount user = users.findByEmail(email)
                .orElseThrow(() -> new AuthException("이메일 또는 비밀번호가 올바르지 않습니다.", 401));
        if (!passwordEncoder.matches(request.password(), user.passwordHash())) {
            throw new AuthException("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
        }
        if (requireEmailVerification && !user.emailVerified()) {
            throw new AuthException("이메일 인증 후 로그인할 수 있습니다.", 403);
        }
        clearRateLimit("login:"+email);
        return user;
    }

    public UserAccount requireUser(long id) {
        return users.findById(id).orElseThrow(() -> new AuthException("사용자를 찾을 수 없습니다.", 401));
    }

    @Transactional
    public boolean updateNickname(long userId, String nickname) {
        return users.updateNickname(userId, nickname);
    }

    @Transactional
    public UserAccount loginWithKakao(KakaoClient.KakaoUser kakaoUser) {
        return users.findByProvider("KAKAO", kakaoUser.providerId())
                .orElseGet(() -> {
                    String email = kakaoUser.email();
                    if (email == null || email.isBlank() || users.findByEmail(email).isPresent()) {
                        email = "kakao-" + kakaoUser.providerId() + "@social.studyspace.local";
                    }
                    UserAccount created = users.create(email, passwordEncoder.encode(UUID.randomUUID().toString()),
                            kakaoUser.nickname(), true);
                    users.addProvider(created.id(), "KAKAO", kakaoUser.providerId(), kakaoUser.email());
                    users.saveConsent(created.id());
                    return created;
                });
    }

    public java.util.Optional<UserAccount> existingKakao(KakaoClient.KakaoUser user) {
        return users.findByProvider("KAKAO", user.providerId());
    }

    public void requireConsent(boolean terms, boolean privacy) {
        if (!terms || !privacy) throw new AuthException("필수 약관에 모두 동의해 주세요.", 400);
    }

    public boolean verifyEmail(String rawToken) {
        return users.verifyToken(sha256(rawToken));
    }

    @Transactional
    public AuthModels.PasswordResetResponse requestPasswordReset(AuthModels.PasswordResetRequest request, String baseUrl) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        checkRateLimit("reset:"+email, 10, Duration.ofHours(1));
        String resetUrl = users.findByEmail(email).map(user -> {
            String rawToken = randomToken();
            users.savePasswordResetToken(user.id(), sha256(rawToken), Instant.now().plus(Duration.ofMinutes(30)));
            return baseUrl + "/reset-password.html?token=" + rawToken;
        }).orElse(null);
        if (resetUrl != null) {
            try {
                resetMailer.send(email, resetUrl);
            } catch (RuntimeException deliveryFailure) {
                // Keep the response indistinguishable for known and unknown accounts.
                // A fresh request can issue a new token if the mail provider is restored.
                log.warn("Password reset email delivery failed: {}", deliveryFailure.getClass().getSimpleName());
            }
        }
        return new AuthModels.PasswordResetResponse(
                "가입된 이메일이라면 비밀번호 재설정 안내를 보냈습니다.");
    }

    @Transactional
    public void resetPassword(AuthModels.PasswordResetConfirmRequest request) {
        if (!users.resetPassword(sha256(request.token()), passwordEncoder.encode(request.password()))) {
            throw new AuthException("유효하지 않거나 만료된 재설정 링크입니다.", 400);
        }
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private final java.util.concurrent.ConcurrentHashMap<String, java.util.ArrayDeque<Long>> rateBuckets = new java.util.concurrent.ConcurrentHashMap<>();
    private void checkRateLimit(String key, int max, Duration window) {
        long now = System.currentTimeMillis();
        var bucket = rateBuckets.computeIfAbsent(key, k -> new java.util.ArrayDeque<>());
        synchronized (bucket) {
            while (!bucket.isEmpty() && bucket.peekFirst() <= now - window.toMillis()) bucket.pollFirst();
            if (bucket.size() >= max) throw new AuthException("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429);
            bucket.addLast(now);
        }
    }
    private void clearRateLimit(String key) { rateBuckets.remove(key); }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
