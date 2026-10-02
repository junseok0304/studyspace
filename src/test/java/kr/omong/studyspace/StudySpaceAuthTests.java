package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.mail.javamail.JavaMailSender;
import jakarta.mail.BodyPart;
import jakarta.mail.Multipart;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.util.Properties;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.mockito.Mockito.verify;
import org.mockito.ArgumentCaptor;

@SpringBootTest
@AutoConfigureMockMvc
class StudySpaceAuthTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @MockitoBean JavaMailSender mailSender;

    @Test
    void signupLoginMeAndLogout() throws Exception {
        String signup = "{\"email\":\"student@example.com\",\"password\":\"password123\",\"nickname\":\"학생\",\"termsAccepted\":true,\"privacyAccepted\":true}";
        mvc.perform(post("/api/auth/signup")
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(signup))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.email").value("student@example.com"));

        var login = mvc.perform(post("/api/auth/login")
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"student@example.com\",\"password\":\"password123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.nickname").value("학생"))
                .andReturn();

        var session = login.getRequest().getSession(false);
        mvc.perform(get("/api/auth/me").session((org.springframework.mock.web.MockHttpSession) session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value("student@example.com"));

        mvc.perform(post("/api/auth/logout")
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .session((org.springframework.mock.web.MockHttpSession) session))
                .andExpect(status().isOk());
        mvc.perform(get("/api/auth/me").session((org.springframework.mock.web.MockHttpSession) session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void duplicateEmailAndWrongPasswordAreRejected() throws Exception {
        String signup = "{\"email\":\"duplicate@example.com\",\"password\":\"password123\",\"nickname\":\"학생\",\"termsAccepted\":true,\"privacyAccepted\":true}";
        mvc.perform(post("/api/auth/signup").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(signup))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/auth/signup").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(signup))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/auth/login").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"duplicate@example.com\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void repeatedWrongLoginsAreRateLimited() throws Exception {
        for (int i = 0; i < 8; i++) {
            mvc.perform(post("/api/auth/login").with(SecurityMockMvcRequestPostProcessors.csrf())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"email\":\"limited@example.com\",\"password\":\"wrong-password\"}"))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"limited@example.com\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    void kakaoLoginIsExplicitlyDisabledUntilConfigured() throws Exception {
        mvc.perform(get("/api/auth/kakao"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("카카오 로그인이 아직 설정되지 않았습니다."));
    }

    @Test
    void signupRequiresBothAgreements() throws Exception {
        mvc.perform(post("/api/auth/signup").with(SecurityMockMvcRequestPostProcessors.csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"no-consent@example.com\",\"password\":\"password123\",\"nickname\":\"학생\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/kakao/complete").with(SecurityMockMvcRequestPostProcessors.csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"termsAccepted\":true,\"privacyAccepted\":true}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/signup.html")).andExpect(status().isOk());
        mvc.perform(get("/terms.html")).andExpect(status().isOk());
        mvc.perform(get("/privacy.html")).andExpect(status().isOk());
    }

    @Test
    void passwordResetDoesNotRevealAccountsAndTokenCanOnlyBeUsedOnce() throws Exception {
        String email = "reset@example.com";
        mvc.perform(post("/api/auth/signup").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"password123\",\"nickname\":\"학생\",\"termsAccepted\":true,\"privacyAccepted\":true}"))
                .andExpect(status().isCreated());

        mvc.perform(post("/api/auth/password-reset/request").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"missing@example.com\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("가입된 이메일이라면 비밀번호 재설정 안내를 보냈습니다."))
                .andExpect(jsonPath("$.developmentResetUrl").doesNotExist());

        org.mockito.Mockito.when(mailSender.createMimeMessage())
                .thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
        var result = mvc.perform(post("/api/auth/password-reset/request").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isOk()).andReturn();
        ArgumentCaptor<MimeMessage> messageCaptor=ArgumentCaptor.forClass(MimeMessage.class);
        verify(mailSender).send(messageCaptor.capture());
        MimeMessage sentMessage = messageCaptor.getValue();
        org.junit.jupiter.api.Assertions.assertEquals("[StudySpace] 비밀번호 재설정", sentMessage.getSubject());
        String[] bodies = extractTextParts(sentMessage.getContent());
        String textBody = bodies[0];
        String htmlBody = bodies[1];
        org.junit.jupiter.api.Assertions.assertTrue(htmlBody.contains("비밀번호 재설정하기"));
        String resetUrl=java.util.Arrays.stream(textBody.split("\\R"))
                .filter(line->line.contains("/reset-password.html?token=")).findFirst().orElseThrow();
        String token = URI.create(resetUrl).getQuery().substring("token=".length());
        String confirm = "{\"token\":\"" + token + "\",\"password\":\"new-password-456\"}";

        mvc.perform(post("/api/auth/password-reset/confirm").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(confirm))
                .andExpect(status().isOk());
        mvc.perform(post("/api/auth/password-reset/confirm").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(confirm))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"new-password-456\"}"))
                .andExpect(status().isOk());
    }

    private String[] extractTextParts(Object content) throws Exception {
        StringBuilder plain = new StringBuilder();
        StringBuilder html = new StringBuilder();
        StringBuilder types = new StringBuilder();
        appendTextParts(content, plain, html, types);
        org.junit.jupiter.api.Assertions.assertFalse(plain.isEmpty());
        org.junit.jupiter.api.Assertions.assertFalse(html.isEmpty(), types.toString());
        return new String[]{plain.toString(), html.toString()};
    }

    private void appendTextParts(Object content, StringBuilder plain, StringBuilder html, StringBuilder types) throws Exception {
        if (content instanceof Multipart multipart) {
            for (int i = 0; i < multipart.getCount(); i++) appendTextParts(multipart.getBodyPart(i), plain, html, types);
        } else if (content instanceof BodyPart part) {
            types.append(part.getContentType()).append(';');
            if (part.isMimeType("text/plain")) plain.append(part.getContent());
            else if (part.isMimeType("text/html")) html.append(part.getContent());
            else appendTextParts(part.getContent(), plain, html, types);
        }
    }
}
