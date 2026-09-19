package kr.omong.studyspace.auth;

import java.time.Instant;

public record UserAccount(
        long id,
        String email,
        String passwordHash,
        String nickname,
        boolean emailVerified,
        boolean onboardingCompleted,
        Instant createdAt
) {
    public AuthModels.UserResponse response() {
        return new AuthModels.UserResponse(id, email, nickname, emailVerified, onboardingCompleted, createdAt);
    }
}
