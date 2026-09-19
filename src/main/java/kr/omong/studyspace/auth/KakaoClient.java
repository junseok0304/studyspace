package kr.omong.studyspace.auth;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Optional;

@Component
public class KakaoClient {
    private static final String AUTHORIZE_URL = "https://kauth.kakao.com/oauth/authorize";
    private static final String TOKEN_URL = "https://kauth.kakao.com/oauth/token";
    private static final String USER_INFO_URL = "https://kapi.kakao.com/v2/user/me";

    private final KakaoProperties properties;
    private final ObjectMapper objectMapper;
    private final RestClient restClient = RestClient.builder().build();

    public KakaoClient(KakaoProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public boolean available() {
        return properties.enabled() && hasText(properties.restApiKey()) && hasText(properties.redirectUri());
    }

    public String authorizationUrl(String state) {
        if (!available()) {
            throw new AuthException("카카오 로그인이 아직 설정되지 않았습니다.", 503);
        }
        return UriComponentsBuilder.fromUriString(AUTHORIZE_URL)
                .queryParam("client_id", properties.restApiKey())
                .queryParam("redirect_uri", properties.redirectUri())
                .queryParam("response_type", "code")
                .queryParam("state", state)
                .build().encode().toUriString();
    }

    public KakaoUser exchangeAndGetUser(String code) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", properties.restApiKey());
        form.add("redirect_uri", properties.redirectUri());
        form.add("code", code);
        if (hasText(properties.clientSecret())) form.add("client_secret", properties.clientSecret());

        try {
            String tokenBody = restClient.post().uri(TOKEN_URL)
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            JsonNode token = objectMapper.readTree(tokenBody);
            String accessToken = Optional.ofNullable(token.get("access_token"))
                    .map(JsonNode::asText).filter(this::hasText)
                    .orElseThrow(() -> new AuthException("카카오 액세스 토큰을 받지 못했습니다.", 502));
            String userBody = restClient.get().uri(USER_INFO_URL)
                    .header("Authorization", "Bearer " + accessToken)
                    .retrieve()
                    .body(String.class);
            JsonNode user = objectMapper.readTree(userBody);
            long providerId = Optional.ofNullable(user.get("id"))
                    .map(JsonNode::asLong)
                    .filter(id -> id > 0)
                    .orElseThrow(() -> new AuthException("카카오 사용자 정보를 확인하지 못했습니다.", 502));
            JsonNode account = user.path("kakao_account");
            String email = text(account, "email");
            String nickname = text(account.path("profile"), "nickname");
            if (!hasText(nickname)) nickname = "카카오 사용자";
            return new KakaoUser(Long.toString(providerId), email, nickname);
        } catch (AuthException e) {
            throw e;
        } catch (RestClientException e) {
            throw new AuthException("카카오 인증 서버와 통신하지 못했습니다.", 502);
        } catch (Exception e) {
            throw new AuthException("카카오 사용자 응답을 해석하지 못했습니다.", 502);
        }
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    public record KakaoUser(String providerId, String email, String nickname) {}
}
