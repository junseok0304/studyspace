package kr.omong.studyspace.study;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SchoolAdapterErrorsTests {
    @Test void onlyConfirmedCredentialRejectionUsesPasswordMessage() {
        assertEquals("LMS 아이디 또는 비밀번호를 확인해주세요",SchoolAdapter.failure("invalid_credentials").getMessage());
        for(String code : new String[]{"session_conflict","session_expired","redirect_limit","lms_response_changed","network_timeout","school_unavailable","unexpected_destination","untrusted-external-text"}) {
            var error=SchoolAdapter.failure(code);
            assertFalse(error.getMessage().contains("아이디 또는 비밀번호"));
            assertFalse(error.getMessage().contains("untrusted-external-text"));
        }
        assertEquals(409,SchoolAdapter.failure("session_conflict").status());
        assertEquals(504,SchoolAdapter.failure("network_timeout").status());
        assertEquals(502,SchoolAdapter.failure("lms_response_changed").status());
    }
}
