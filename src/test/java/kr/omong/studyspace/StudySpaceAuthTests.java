package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class StudySpaceAuthTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

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
        for (int i = 0; i < 5; i++) {
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

        var result = mvc.perform(post("/api/auth/password-reset/request").with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isOk()).andReturn();
        String resetUrl = json.readTree(result.getResponse().getContentAsByteArray()).get("developmentResetUrl").asText();
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
}
