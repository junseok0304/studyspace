package kr.omong.studyspace.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final UserAccountRepository users;
    private final PasswordEncoder passwordEncoder;
    private final boolean requireEmailVerification;
    private final SecureRandom secureRandom = new SecureRandom();

    public AuthService(UserAccountRepository users,
                       PasswordEncoder passwordEncoder,
                       @Value("${studyspace.auth.require-email-verification:false}") boolean requireEmailVerification) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.requireEmailVerification = requireEmailVerification;
    }

    @Transactional
    public AuthModels.SignupResponse signup(AuthModels.SignupRequest request, String baseUrl) {
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        String nickname = request.nickname().trim();
        if (users.findByEmail(email).isPresent()) {
            throw new AuthException("이미 가입된 이메일입니다.", 409);
        }
        try {
            UserAccount user = users.create(email, passwordEncoder.encode(request.password()), nickname, !requireEmailVerification);
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
        UserAccount user = users.findByEmail(email)
                .orElseThrow(() -> new AuthException("이메일 또는 비밀번호가 올바르지 않습니다.", 401));
        if (!passwordEncoder.matches(request.password(), user.passwordHash())) {
            throw new AuthException("이메일 또는 비밀번호가 올바르지 않습니다.", 401);
        }
        if (requireEmailVerification && !user.emailVerified()) {
            throw new AuthException("이메일 인증 후 로그인할 수 있습니다.", 403);
        }
        return user;
    }

    public UserAccount requireUser(long id) {
        return users.findById(id).orElseThrow(() -> new AuthException("사용자를 찾을 수 없습니다.", 401));
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
                    return created;
                });
    }

    public boolean verifyEmail(String rawToken) {
        return users.verifyToken(sha256(rawToken));
    }

    private String randomToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
