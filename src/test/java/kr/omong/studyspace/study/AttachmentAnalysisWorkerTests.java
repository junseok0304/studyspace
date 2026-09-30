package kr.omong.studyspace.study;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.mockito.Mockito.*;

class AttachmentAnalysisWorkerTests {
    @Test void mockModeDoesNotQueueOrCallPaidSummaries() {
        var db=mock(JdbcTemplate.class);
        var gemini=mock(GeminiGenerator.class);
        var executor=mock(org.springframework.core.task.TaskExecutor.class);
        var worker=new AttachmentAnalysisWorker(db,mock(AttachmentStorage.class),executor,gemini,
                mock(UsageRecorder.class),"gemini-test",true);
        worker.startSummary("attachment",1);
        verifyNoInteractions(db,executor,gemini);
    }

    @Test void failedSummaryCanBeClaimedOnceForExplicitRetry() {
        var db=mock(JdbcTemplate.class);
        var executor=mock(org.springframework.core.task.TaskExecutor.class);
        when(db.update(anyString(),eq("attachment"),eq(1L))).thenReturn(1,0);
        var worker=new AttachmentAnalysisWorker(db,mock(AttachmentStorage.class),executor,mock(GeminiGenerator.class),
                mock(UsageRecorder.class),"gemini-test",false);
        worker.startSummary("attachment",1);
        worker.startSummary("attachment",1);
        verify(executor,times(1)).execute(any(Runnable.class));
        verify(db,times(2)).update(contains("'NOT_SUMMARIZED','FAILED'"),eq("attachment"),eq(1L));
    }
}
