package kr.omong.studyspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final AuthenticationManager authenticationManager;
    private final SessionAuthenticationService sessionAuthenticationService;

    public AuthController(AuthService authService,
                          AuthenticationManager authenticationManager,
                          SessionAuthenticationService sessionAuthenticationService) {
        this.authService = authService;
        this.authenticationManager = authenticationManager;
        this.sessionAuthenticationService = sessionAuthenticationService;
    }

    @PostMapping("/signup")
    public ResponseEntity<AuthModels.SignupResponse> signup(@Valid @RequestBody AuthModels.SignupRequest request,
                                                            HttpServletRequest httpRequest) {
        String baseUrl = httpRequest.getRequestURL().toString().replace("/api/auth/signup", "");
        return ResponseEntity.status(201).body(authService.signup(request, baseUrl));
    }

    @PostMapping("/login")
    public AuthModels.AuthResponse login(@Valid @RequestBody AuthModels.LoginRequest request,
                                         HttpServletRequest httpRequest,
                                         HttpServletResponse httpResponse) {
        UserAccount user = authService.authenticate(request);
        Authentication authentication = authenticationManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(user.email(), request.password()));
        sessionAuthenticationService.save(authentication, httpRequest, httpResponse);
        return new AuthModels.AuthResponse(user.response());
    }

    @GetMapping("/me")
    public AuthModels.AuthResponse me(Authentication authentication) {
        UserAccount user = authService.requireUser(Long.parseLong(authentication.getName()));
        return new AuthModels.AuthResponse(user.response());
    }

    @GetMapping("/verify-email")
    public ResponseEntity<AuthModels.MessageResponse> verifyEmail(@RequestParam String token) {
        if (!authService.verifyEmail(token)) {
            throw new AuthException("유효하지 않거나 만료된 인증 링크입니다.", 400);
        }
        return ResponseEntity.ok(new AuthModels.MessageResponse("이메일 인증이 완료되었습니다. 로그인해 주세요."));
    }
}
