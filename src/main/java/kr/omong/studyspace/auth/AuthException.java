package kr.omong.studyspace.auth;

public class AuthException extends RuntimeException {
    private final int status;

    public AuthException(String message, int status) {
        super(message);
        this.status = status;
    }

    public int status() {
        return status;
    }
}
