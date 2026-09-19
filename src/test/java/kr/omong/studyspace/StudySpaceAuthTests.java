package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class StudySpaceAuthTests {
    @Autowired MockMvc mvc;

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
}
