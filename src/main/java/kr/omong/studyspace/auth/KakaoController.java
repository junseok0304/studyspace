package kr.omong.studyspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.servlet.view.RedirectView;

import java.security.SecureRandom;
import java.util.Base64;

@Controller
@RequestMapping("/api/auth/kakao")
public class KakaoController {
    private static final String STATE_SESSION_KEY = "studyspace.kakao.oauth.state";
    private static final String STATE_CREATED_SESSION_KEY = "studyspace.kakao.oauth.state.created";
    private final SecureRandom secureRandom = new SecureRandom();
    private final KakaoProperties properties;
    private final KakaoClient kakaoClient;
    private final AuthService authService;
    private final SessionAuthenticationService sessionAuthenticationService;

    public KakaoController(KakaoProperties properties,
                           KakaoClient kakaoClient,
                           AuthService authService,
                           SessionAuthenticationService sessionAuthenticationService) {
        this.properties = properties;
        this.kakaoClient = kakaoClient;
        this.authService = authService;
        this.sessionAuthenticationService = sessionAuthenticationService;
    }

    @GetMapping
    public RedirectView start(HttpServletRequest request) {
        String state = randomState();
        request.getSession(true).setAttribute(STATE_SESSION_KEY, state);
        request.getSession().setAttribute(STATE_CREATED_SESSION_KEY, System.currentTimeMillis());
        return new RedirectView(kakaoClient.authorizationUrl(state));
    }

    @GetMapping("/callback")
    public RedirectView callback(String code,
                                 String state,
                                 String error,
                                 HttpServletRequest request,
                                 HttpServletResponse response) {
        if (error != null) throw new AuthException("카카오 로그인이 취소되었거나 실패했습니다.", 400);
        var session = request.getSession(false);
        Object expected = session == null ? null : session.getAttribute(STATE_SESSION_KEY);
        Object created = session == null ? null : session.getAttribute(STATE_CREATED_SESSION_KEY);
        if (session != null) {
            session.removeAttribute(STATE_SESSION_KEY);
            session.removeAttribute(STATE_CREATED_SESSION_KEY);
        }
        if (expected == null || state == null || !expected.equals(state)
                || !(created instanceof Long) || System.currentTimeMillis() - (Long) created > 10 * 60_000L) {
            throw new AuthException("카카오 로그인 상태 검증에 실패했습니다.", 400);
        }
        if (code == null || code.isBlank()) throw new AuthException("카카오 인가 코드가 없습니다.", 400);
        UserAccount user = authService.loginWithKakao(kakaoClient.exchangeAndGetUser(code));
        sessionAuthenticationService.save(sessionAuthenticationService.forUser(user), request, response);
        return new RedirectView(properties.publicBaseUrl() + "/?kakao=success");
    }

    private String randomState() {
        byte[] value = new byte[32];
        secureRandom.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
