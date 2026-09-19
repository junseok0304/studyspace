package kr.omong.studyspace.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "studyspace.kakao")
public record KakaoProperties(
        boolean enabled,
        String restApiKey,
        String javascriptKey,
        String clientSecret,
        String redirectUri,
        String publicBaseUrl
) {
}
