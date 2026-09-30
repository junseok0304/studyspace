package kr.omong.studyspace.auth;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KakaoClientTests {
    @Test void activeClientSecretRequiresServerConfiguration() {
        var properties=new KakaoProperties(true,"rest-key","javascript-key","",true,
                "http://localhost:8091/api/auth/kakao/callback","http://localhost:8091");
        var client=new KakaoClient(properties,new ObjectMapper());
        AuthException error=assertThrows(AuthException.class,()->client.authorizationUrl("state"));
        assertEquals(503,error.status());
        assertEquals("카카오 로그인 클라이언트 시크릿이 서버에 설정되지 않았습니다.",error.getMessage());
    }

    @Test void configuredSecretKeepsItOutOfAuthorizationUrl() {
        var properties=new KakaoProperties(true,"rest-key","javascript-key","secret",true,
                "http://localhost:8091/api/auth/kakao/callback","http://localhost:8091");
        String url=new KakaoClient(properties,new ObjectMapper()).authorizationUrl("safe-state");
        assertTrue(url.contains("client_id=rest-key"));
        assertTrue(url.contains("state=safe-state"));
        assertTrue(!url.contains("secret"));
    }
}
