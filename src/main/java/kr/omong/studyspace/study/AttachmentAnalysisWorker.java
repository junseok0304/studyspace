package kr.omong.studyspace.study;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.io.InputStream;

@Component
public class AttachmentAnalysisWorker {
    private final JdbcTemplate db;
    private final AttachmentStorage storage;
    private final TaskExecutor executor;
    private final GeminiGenerator gemini;
    private final UsageRecorder usage;
    private final String model;
    private final boolean mockEnabled;
    private final AiUsageLimiter aiUsageLimiter;

    public AttachmentAnalysisWorker(JdbcTemplate db,AttachmentStorage storage,@Qualifier("generationExecutor") TaskExecutor executor,
                                    GeminiGenerator gemini,UsageRecorder usage,@Value("${studyspace.ai.model:gemini-3.6-flash}") String model,
                                    @Value("${studyspace.ai.mock-enabled:true}") boolean mockEnabled,
                                    AiUsageLimiter aiUsageLimiter) {
        this.db=db; this.storage=storage; this.executor=executor; this.gemini=gemini; this.usage=usage; this.model=model;
        this.mockEnabled=mockEnabled;
        this.aiUsageLimiter=aiUsageLimiter;
    }

    public void start(String id,long userId) {
        int claimed=db.update("update attachments set analysis_status='ANALYZING',analysis_error_code=null,analyzed_at=null where id=? and user_id=? and analysis_status in ('NOT_ANALYZED','FAILED','AWAITING_AI')",id,userId);
        if(claimed==1) executor.execute(() -> process(id,userId));
    }

    public void startSummary(String id,long userId) {
        if(mockEnabled) return;
        int claimed=db.update("update attachments set summary_status='ANALYZING',summary_error_code=null where id=? and user_id=? and analysis_status='TEXT_READY' and summary_status in ('NOT_SUMMARIZED','FAILED')",id,userId);
        if(claimed==1) executor.execute(() -> summarize(id,userId));
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterrupted() {
        var interrupted=db.query("select id,user_id from attachments where analysis_status='ANALYZING'",(row,index)->new Work(row.getString("id"),row.getLong("user_id")));
        for(Work work:interrupted) executor.execute(() -> process(work.id(),work.userId()));
        var summaries=db.query("select id,user_id from attachments where analysis_status='TEXT_READY' and summary_status='ANALYZING'",(row,index)->new Work(row.getString("id"),row.getLong("user_id")));
        for(Work work:summaries) executor.execute(() -> summarize(work.id(),work.userId()));
    }

    private void process(String id,long userId) {
        var rows=db.query("select storage_key,extension,media_type from attachments where id=? and user_id=? and analysis_status='ANALYZING'",
                (row,index)->new Source(row.getString("storage_key"),row.getString("extension"),row.getString("media_type")),id,userId);
        if(rows.isEmpty()) return;
        Source source=rows.getFirst();
        try(InputStream input=storage.open(source.storageKey())) {
            String text;
            if ("png".equals(source.extension())) {
                if(mockEnabled) {
                    db.update("update attachments set analysis_status='AWAITING_AI',analysis_error_code='PROVIDER_DISABLED' where id=? and user_id=?",id,userId);
                    return;
                }
                try {
                    aiUsageLimiter.requireAvailable(userId);
                } catch (kr.omong.studyspace.auth.AuthException limit) {
                    db.update("update attachments set analysis_status='FAILED',analysis_error_code='AI_DAILY_LIMIT',analyzed_at=current_timestamp where id=? and user_id=? and analysis_status='ANALYZING'",id,userId);
                    return;
                }
                byte[] image=input.readAllBytes();
                GeminiGenerator.Result result=gemini.analyzeImage(model,source.mediaType(),image);
                text=result.text();
                usage.record(userId,"IMAGE",model,result.promptTokens(),result.outputTokens());
            } else {
                text=AttachmentAnalyzer.extract(input,source.extension());
            }
            db.update("update attachments set analysis_status='TEXT_READY',extracted_text=?,analysis_error_code=null,analyzed_at=current_timestamp,summary_status='NOT_SUMMARIZED' where id=? and user_id=? and analysis_status='ANALYZING'",text,id,userId);
            startSummary(id,userId);
        } catch (GeminiGenerator.Failure failure) {
            db.update("update attachments set analysis_status='FAILED',extracted_text=null,analysis_error_code=?,analyzed_at=current_timestamp where id=? and user_id=? and analysis_status='ANALYZING'",failure.code,id,userId);
        } catch(Exception error) {
            db.update("update attachments set analysis_status='FAILED',extracted_text=null,analysis_error_code='TEXT_EXTRACTION_FAILED',analyzed_at=current_timestamp where id=? and user_id=? and analysis_status='ANALYZING'",id,userId);
        }
    }

    private void summarize(String id,long userId) {
        if(mockEnabled) {
            db.update("update attachments set summary_status='NOT_SUMMARIZED' where id=? and user_id=? and summary_status='ANALYZING'",id,userId);
            return;
        }
        var rows=db.query("select original_name,extracted_text from attachments where id=? and user_id=? and analysis_status='TEXT_READY' and summary_status='ANALYZING'",(row,index)->new SummarySource(row.getString("original_name"),row.getString("extracted_text")),id,userId);
        if(rows.isEmpty()) return;
        try {
            try {
                aiUsageLimiter.requireAvailable(userId);
            } catch (kr.omong.studyspace.auth.AuthException limit) {
                db.update("update attachments set summary_status='FAILED',summary_error_code='AI_DAILY_LIMIT' where id=? and user_id=? and summary_status='ANALYZING'",id,userId);
                return;
            }
            SummarySource source=rows.getFirst();
            GeminiGenerator.Result result=gemini.summarizeAttachment(model,source.name(),source.text());
            String text=result.text().strip();
            if(text.length()>500) text=text.substring(0,497)+"…";
            db.update("update attachments set summary_status='READY',summary_text=?,summary_error_code=null where id=? and user_id=? and summary_status='ANALYZING'",text,id,userId);
            usage.record(userId,"ATTACHMENT_SUMMARY",model,result.promptTokens(),result.outputTokens());
        } catch(GeminiGenerator.Failure failure) {
            db.update("update attachments set summary_status='FAILED',summary_error_code=? where id=? and user_id=? and summary_status='ANALYZING'",failure.code,id,userId);
        } catch(Exception error) {
            db.update("update attachments set summary_status='FAILED',summary_error_code='PROVIDER_UNAVAILABLE' where id=? and user_id=? and summary_status='ANALYZING'",id,userId);
        }
    }

    private record Work(String id,long userId) {}
    private record Source(String storageKey,String extension,String mediaType) {}
    private record SummarySource(String name,String text) {}
}
