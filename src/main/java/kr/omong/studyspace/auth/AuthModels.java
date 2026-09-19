package kr.omong.studyspace.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public final class AuthModels {
    private AuthModels() {}

    public record SignupRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(min = 8, max = 72) String password,
            @NotBlank @Size(min = 1, max = 50) String nickname,
            boolean termsAccepted,
            boolean privacyAccepted
    ) {}

    public record LoginRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank String password
    ) {}

    public record UserResponse(
            long id,
            String email,
            String nickname,
            boolean emailVerified,
            boolean onboardingCompleted,
            Instant createdAt
    ) {}

    public record AuthResponse(UserResponse user) {}

    public record SignupResponse(
            UserResponse user,
            boolean verificationRequired,
            String developmentVerificationUrl
    ) {}

    public record MessageResponse(String message) {}
}
