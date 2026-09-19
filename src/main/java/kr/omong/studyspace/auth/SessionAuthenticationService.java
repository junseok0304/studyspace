package kr.omong.studyspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SessionAuthenticationService {
    private final SecurityContextRepository securityContextRepository;

    public SessionAuthenticationService(SecurityContextRepository securityContextRepository) {
        this.securityContextRepository = securityContextRepository;
    }

    public void save(Authentication authentication,
                     HttpServletRequest request,
                     HttpServletResponse response) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        if (request.getSession(false) != null) request.changeSessionId();
        request.getSession(true).removeAttribute("school.prompt.shown");
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, request, response);
    }

    public Authentication forUser(UserAccount user) {
        return UsernamePasswordAuthenticationToken.authenticated(
                Long.toString(user.id()), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
    }
}
