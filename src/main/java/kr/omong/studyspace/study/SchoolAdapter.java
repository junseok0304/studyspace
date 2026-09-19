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
        if(!result.path("authenticated").asBoolean()) throw new AuthException("LMS 아이디 또는 비밀번호를 확인해주세요",422);
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
            if(result.has("error")) throw new AuthException(mode.equals("verify") ? "LMS 아이디 또는 비밀번호를 확인해주세요" : "학교 로그인 또는 시간표 조회에 실패했습니다. 학기와 로그인 정보를 확인해 주세요.",422);
            return result;
        } finally { process.destroyForcibly(); }
    }
}
