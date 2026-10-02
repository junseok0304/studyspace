package kr.omong.studyspace.config;

import kr.omong.studyspace.auth.StudySpaceUserDetailsService;
import kr.omong.studyspace.auth.KakaoProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.core.session.SessionRegistryImpl;
import org.springframework.http.HttpStatus;

@Configuration
@EnableWebSecurity
@org.springframework.boot.context.properties.EnableConfigurationProperties(KakaoProperties.class)
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    AuthenticationManager authenticationManager(AuthenticationConfiguration configuration) throws Exception {
        return configuration.getAuthenticationManager();
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http,
                                            SecurityContextRepository securityContextRepository,
                                            SessionRegistry sessionRegistry) throws Exception {
        CookieCsrfTokenRepository csrf = CookieCsrfTokenRepository.withHttpOnlyFalse();
        http
                .securityContext(context -> context.securityContextRepository(securityContextRepository))
                .csrf(csrfConfig -> csrfConfig.csrfTokenRepository(csrf))
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                        .sessionFixation(fixation -> fixation.changeSessionId())
                        .maximumSessions(5).sessionRegistry(sessionRegistry))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/", "/index.html", "/app.css", "/workspace.css", "/app.js", "/favicon.ico", "/assets/**",
                                "/**/*.css", "/**/*.js", "/**/*.png", "/**/*.txt", "/**/*.ico", "/**/*.map",
                                "/api/auth/signup", "/api/auth/login", "/api/auth/verify-email", "/api/auth/csrf",
                                "/api/auth/password-reset/request", "/api/auth/password-reset/confirm",
                                "/api/auth/kakao", "/api/auth/kakao/callback", "/api/auth/kakao/complete",
                                "/signup.html", "/signup.js", "/reset-password.html", "/reset-password.js", "/terms.html", "/privacy.html",
                                "/actuator/health", "/error").permitAll()
                        .anyRequest().authenticated())
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .invalidateHttpSession(true)
                        .clearAuthentication(true)
                        .deleteCookies("JSESSIONID", "XSRF-TOKEN")
                        .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler()))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) -> {
                            if (request.getRequestURI().startsWith("/api/")) {
                                response.sendError(HttpStatus.UNAUTHORIZED.value());
                            } else {
                                response.sendRedirect(request.getContextPath() + "/?sessionExpired=true");
                            }
                        }));
        return http.build();
    }

    @Bean
    SessionRegistry sessionRegistry() { return new SessionRegistryImpl(); }

    @Bean
    DaoAuthenticationProvider authenticationProvider(StudySpaceUserDetailsService users,
                                                     PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(users);
        provider.setPasswordEncoder(passwordEncoder);
        return provider;
    }
}
