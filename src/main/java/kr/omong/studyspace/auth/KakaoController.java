package kr.omong.studyspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.servlet.view.RedirectView;

import java.security.SecureRandom;
import java.util.Base64;
import java.net.URI;

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
        RedirectView canonicalLocalHost = canonicalLocalHostRedirect(request);
        if (canonicalLocalHost != null) return canonicalLocalHost;

        String state = randomState();
        var session = request.getSession(true);
        session.setAttribute(STATE_SESSION_KEY, state);
        session.setAttribute(STATE_CREATED_SESSION_KEY, System.currentTimeMillis());
        return new RedirectView(kakaoClient.authorizationUrl(state));
    }

    /**
     * The configured local redirect URI is registered with Kakao using one
     * hostname (normally localhost). Browsers treat localhost and 127.0.0.1
     * as different cookie hosts, so normalize the OAuth start request before
     * creating the session-bound state value.
     */
    private RedirectView canonicalLocalHostRedirect(HttpServletRequest request) {
        if (!isLoopback(request.getServerName())) return null;
        if (properties.redirectUri() == null || properties.redirectUri().isBlank()) return null;
        URI configured;
        try {
            configured = URI.create(properties.redirectUri());
        } catch (IllegalArgumentException ignored) {
            return null;
        }
        String configuredHost = configured.getHost();
        if (!isLoopback(configuredHost)
                || configuredHost.equalsIgnoreCase(request.getServerName())) return null;

        int port = configured.getPort() > 0 ? configured.getPort() : request.getServerPort();
        String target = new StringBuilder()
                .append(configured.getScheme()).append("://")
                .append(configuredHost)
                .append(port > 0 ? ":" + port : "")
                .append(request.getRequestURI())
                .toString();
        return new RedirectView(target);
    }

    private boolean isLoopback(String host) {
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "[::1]".equals(host)
                || "::1".equals(host);
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
        var kakaoUser = kakaoClient.exchangeAndGetUser(code);
        var existing = authService.existingKakao(kakaoUser);
        if (existing.isEmpty()) {
            session.setAttribute("kakao.pending", kakaoUser);
            session.setAttribute("kakao.pending.at", System.currentTimeMillis());
            return new RedirectView(properties.publicBaseUrl() + "/signup.html?social=kakao");
        }
        UserAccount user = existing.get();
        sessionAuthenticationService.save(sessionAuthenticationService.forUser(user), request, response);
        return new RedirectView(properties.publicBaseUrl() + "/?kakao=success");
    }

    public record Consent(boolean termsAccepted, boolean privacyAccepted) {}

    @org.springframework.web.bind.annotation.PostMapping("/complete")
    @org.springframework.web.bind.annotation.ResponseBody
    public AuthModels.AuthResponse complete(@org.springframework.web.bind.annotation.RequestBody Consent consent,
                                            HttpServletRequest request, HttpServletResponse response) {
        authService.requireConsent(consent.termsAccepted(), consent.privacyAccepted());
        var session = request.getSession(false);
        if (session == null) throw new AuthException("카카오 인증을 다시 시작해 주세요.", 400);
        synchronized (session) {
            Object pending = session.getAttribute("kakao.pending");
            Object at = session.getAttribute("kakao.pending.at");
            if (!(pending instanceof KakaoClient.KakaoUser user) || !(at instanceof Long time)
                    || System.currentTimeMillis() - time > 600000L)
                throw new AuthException("카카오 인증을 다시 시작해 주세요.", 400);
            var account = authService.loginWithKakao(user);
            session.removeAttribute("kakao.pending");
            session.removeAttribute("kakao.pending.at");
            sessionAuthenticationService.save(sessionAuthenticationService.forUser(account), request, response);
            return new AuthModels.AuthResponse(account.response());
        }
    }

    private String randomState() {
        byte[] value = new byte[32];
        secureRandom.nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }
}
