package kr.omong.studyspace.study;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import kr.omong.studyspace.auth.AuthException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
public class SchoolAdapter {
    private final ObjectMapper json;
    private final String python;
    public SchoolAdapter(ObjectMapper json,@Value("${STUDYSPACE_PYTHON:python3}") String python) { this.json=json; this.python=python; }
    public JsonNode fetch(String credentials, int year, String semester) throws Exception {
        return run(credentials,year,semester,"timetable");
    }
    public void verify(String credentials) throws Exception {
        var result=run(credentials,2000,"1","verify");
        if(!result.path("authenticated").asBoolean()) throw failure("lms_response_changed");
    }
    private JsonNode run(String credentials, int year, String semester, String mode) throws Exception {
        Process process = new ProcessBuilder(python,"scripts/school_adapter.py").redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            var input = Map.of("credentials",json.readTree(credentials),"year",year,"semester",semester,"mode",mode);
            try(var stream=process.getOutputStream()) { stream.write(json.writeValueAsBytes(input)); }
            var output = java.util.concurrent.CompletableFuture.supplyAsync(() -> {
                try { return process.getInputStream().readNBytes(60000); }
                catch(java.io.IOException e) { throw new java.util.concurrent.CompletionException(e); }
            });
            if(!process.waitFor(90,TimeUnit.SECONDS)) throw new AuthException("학교 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",504);
            byte[] response = output.get(5,TimeUnit.SECONDS);
            if(process.exitValue()!=0) throw new AuthException("학교 연동 프로그램을 실행하지 못했습니다.",503);
            var result=json.readTree(new String(response,StandardCharsets.UTF_8));
            if(result == null || !result.isObject()) throw failure("school_response_changed");
            if(result.has("error")) {
                if ("unexpected_destination".equals(result.path("error").asText())) {
                    String host=result.path("destination").path("host").asText();
                    String scheme=result.path("destination").path("scheme").asText();
                    if(host.matches("[a-z0-9.-]+\\.skhu\\.ac\\.kr") && (scheme.equals("http") || scheme.equals("https")))
                        throw new AuthException("학교 로그인 이동 경로 확인이 필요합니다. ("+scheme+": "+host+")",502);
                }
                throw failure(result.path("error").asText());
            }
            return result;
        } finally { process.destroyForcibly(); }
    }
    static AuthException failure(String code) {
        return switch (code) {
            case "invalid_credentials" -> new AuthException("LMS 아이디 또는 비밀번호를 확인해주세요",422);
            case "session_conflict" -> new AuthException("학교에서 로그인 세션 충돌을 알렸습니다. 다른 학교 서비스의 로그인 작업을 마친 뒤 다시 시도해주세요.",409);
            case "session_expired", "redirect_limit", "tis_session_failed" -> new AuthException("학교 로그인 후 연결 세션을 확보하지 못했습니다. 잠시 후 다시 시도해주세요. (학교 세션 연결)",502);
            case "network_timeout" -> new AuthException("학교 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.",504);
            case "school_unavailable" -> new AuthException("학교 서버에 연결하지 못했습니다. 학교 사이트 접속 상태를 확인한 뒤 다시 시도해주세요.",503);
            case "login_rejected" -> new AuthException("학교 포털이 로그인 요청을 거부했습니다. 학교 사이트에서 직접 로그인 가능한지 확인해주세요.",422);
            case "enrollment_login_failed" -> new AuthException("LMS 과목은 확인했지만 수강신청 사이트에서 시간표를 가져오지 못했습니다. 과목을 시간 미확인으로 먼저 반영할 수 있습니다.",422);
            case "semester_mismatch" -> new AuthException("학교 수강내역과 선택한 학기가 다르거나 학기를 확인할 수 없습니다. 학기를 확인해주세요.",422);
            case "unexpected_destination" -> new AuthException("학교 로그인 이동 경로가 변경되어 연동을 중단했습니다. 연동 경로 확인이 필요합니다.",502);
            case "lms_response_changed" -> new AuthException("LMS 응답에서 로그인 완료를 확인하지 못했습니다. LMS 연동 화면 형식 확인이 필요합니다.",502);
            default -> new AuthException("학교 응답을 처리하지 못했습니다. 계정 정보가 아닌 연동 프로그램 확인이 필요합니다.",502);
        };
    }
}
