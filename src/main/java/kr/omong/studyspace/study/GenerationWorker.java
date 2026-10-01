package kr.omong.studyspace.study;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.task.TaskExecutor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class GenerationWorker {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final TaskExecutor executor;
    private final boolean mockEnabled;
    private final ObjectMapper json;
    private final GeminiGenerator gemini;
    private final UsageRecorder usage;
    private final java.util.concurrent.ConcurrentHashMap<Long,java.util.concurrent.Semaphore> userSlots = new java.util.concurrent.ConcurrentHashMap<>();

    public GenerationWorker(JdbcTemplate db, TransactionTemplate tx,
                            @Qualifier("generationExecutor") TaskExecutor executor,
                            @Value("${studyspace.ai.mock-enabled:true}") boolean mockEnabled,ObjectMapper json,GeminiGenerator gemini,UsageRecorder usage) {
        this.db = db;
        this.tx = tx;
        this.executor = executor;
        this.mockEnabled = mockEnabled;
        this.json=json;
        this.gemini=gemini;
        this.usage=usage;
    }

    public void enqueue(String jobId, long userId) {
        executor.execute(() -> {
            var slots=userSlots.computeIfAbsent(userId, ignored -> new java.util.concurrent.Semaphore(3));
            if(!slots.tryAcquire()) return;
            try {
                process(jobId,userId);
            } finally {
                slots.release();
                enqueueNextPending(userId);
            }
        });
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterruptedJobs() {
        db.update("update generation_jobs set status='PENDING',started_at=null where status='RUNNING'");
        List<JobOwner> jobs = db.query("select id,user_id from generation_jobs where status='PENDING' order by created_at",
                (row,index) -> new JobOwner(row.getString("id"),row.getLong("user_id")));
        jobs.forEach(job -> enqueue(job.id(),job.userId()));
    }

    private void enqueueNextPending(long userId) {
        var pending=db.query("select id from generation_jobs where user_id=? and status='PENDING' order by created_at,id limit 1",
                (row,index)->row.getString("id"),userId);
        if(!pending.isEmpty()) enqueue(pending.getFirst(),userId);
    }

    private void process(String jobId, long userId) {
        if (db.update("update generation_jobs set status='RUNNING',started_at=current_timestamp where id=? and user_id=? and status='PENDING'",jobId,userId) != 1) return;
        try {
            Boolean savedMock=db.queryForObject("select mock_result from generation_jobs where id=? and user_id=?",Boolean.class,jobId,userId);
            if(!Boolean.TRUE.equals(savedMock) && mockEnabled) throw new GenerationFailure("PROVIDER_DISABLED");
            boolean useMock=Boolean.TRUE.equals(savedMock);
            var inputs = db.query("select j.kind,j.source_note_version,j.model,coalesce(j.source_title,n.title) title,coalesce(j.source_body,n.body) body from generation_jobs j join notes n on n.id=j.note_id and n.user_id=j.user_id where j.id=? and j.user_id=?",
                    (row,index) -> new Input(row.getString("kind"),row.getLong("source_note_version"),row.getString("model"),row.getString("title"),row.getString("body")),jobId,userId);
            if (inputs.isEmpty()) throw new GenerationFailure("SOURCE_NOT_FOUND");
            Input input=inputs.getFirst();
            List<Source> sources=db.query("select original_name,extracted_text from generation_job_sources where job_id=? order by source_order",
                    (row,index)->new Source(row.getString("original_name"),row.getString("extracted_text")),jobId);
            String artifactId=UUID.randomUUID().toString();
            String title=switch(input.kind()){case "SUMMARY"->"요점 정리";case "SUBJECTIVE_QUIZ"->"주관식 확인 문제";case "AI_NOTE"->"AI 학습 노트";case "MIND_MAP"->"마인드맵";case "INFOGRAPHIC"->"인포그래픽";default->"학습 자료";}+" · "+input.title();
            StringBuilder source=new StringBuilder("노트: ").append(input.title()).append("\n버전: ").append(input.version()).append("\n").append(input.body());
            for(Source attachment:sources) source.append("\n\n자료: ").append(attachment.name()).append("\n").append(attachment.text());
            String content;
            if(useMock) content=mockContent(input,sources);
            else {
                GeminiGenerator.Result result=gemini.generate(input.model(),input.kind(),source.toString());
                content=result.text();
                usage.record(userId,input.kind(),input.model(),result.promptTokens(),result.outputTokens());
            }
            tx.executeWithoutResult(status -> {
                int inserted=db.update("insert into learning_artifacts(id,job_id,user_id,note_id,kind,title,content,source_note_version,model,mock_result) select ?,id,user_id,note_id,kind,?,?,source_note_version,model,? from generation_jobs where id=? and user_id=? and status='RUNNING'",
                        artifactId,title,content,useMock,jobId,userId);
                if(inserted==1) db.update("update generation_jobs set status='COMPLETED',completed_at=current_timestamp,error_code=null where id=? and user_id=? and status='RUNNING'",jobId,userId);
            });
        } catch (GeminiGenerator.Failure failure) {
            fail(jobId,userId,failure.code);
        } catch (GenerationFailure failure) {
            fail(jobId,userId,failure.code);
        } catch (Exception unexpected) {
            fail(jobId,userId,"GENERATION_FAILED");
        }
    }

    private String mockContent(Input input,List<Source> sources) {
        if("SUMMARY".equals(input.kind())) return mockSummary(input,sources);
        var material=new StringBuilder(input.body());
        for(Source attachment:sources) material.append("\n").append(attachment.text());
        List<String> passages=MockStudyContent.passagesExcluding(input.title(),material.toString());
        if(passages.isEmpty()) passages=List.of(input.title()+" 노트에 작성된 내용을 확인해 주세요.");
        String excerpt=String.join("\n\n",passages.stream().limit(8).map(value->"- "+value).toList());
        String sourcePreview=sourcePreview(sources);
        if("INFOGRAPHIC".equals(input.kind())) return mockInfographic(input.title(),passages);
        if("MIND_MAP".equals(input.kind())) {
            var children=new java.util.ArrayList<MindNode>();
            for(String part:passages){String value=MockStudyContent.clip(part,72);children.add(new MindNode(value,List.of()));if(children.size()==8)break;}
            return json.writeValueAsString(new MindNode(input.title(),children));
        }
        if("AI_NOTE".equals(input.kind())) return """
                > 노트와 첨부자료의 원문을 이용한 개발용 미리보기입니다. Gemini API를 호출하지 않았습니다.

                # %s

                ## 핵심 개념

                %s

                ## 혼동하기 쉬운 점

                - 원문과 강의자료를 다시 대조해 확인하세요.

                ## 확인 질문

                - 이 내용을 자신의 말로 설명할 수 있나요?

                %s
                """.formatted(input.title(),excerpt,sourcePreview);
        return """
                > 개발용 미리보기입니다. Gemini API를 호출하지 않았습니다.

                1. 이 노트에서 가장 중요한 개념을 한 문장으로 설명해 보세요.
                2. 원문에서 이해가 어려운 부분을 하나 고르고, 필요한 선행 개념을 적어 보세요.
                3. 실제 강의나 과제에 적용할 수 있는 예시를 하나 만들어 보세요.

                생성 근거: `%s` 버전 %d
                %s
                """.formatted(input.title(),input.version(),sourcePreview);
    }

    private String mockSummary(Input input,List<Source> sources) {
        List<String> note=representative(MockStudyContent.passagesExcluding(input.title(),input.body()),10);
        var attachments=new java.util.LinkedHashSet<String>();
        for(Source source:sources) attachments.addAll(representative(MockStudyContent.passages(source.text()),4));
        if(note.isEmpty()&&attachments.isEmpty()) return "## 요약\n\n현재 노트에는 요약할 내용이 충분하지 않습니다. 노트에 수업 내용을 적은 뒤 다시 생성해 주세요.";
        var summary=new StringBuilder("## 요약\n");
        if(!note.isEmpty()) {
            summary.append("\n### 수업노트\n\n");
            summary.append(String.join("\n\n",note));
        }
        if(!attachments.isEmpty()) {
            summary.append("\n\n### 첨부자료\n\n");
            summary.append(String.join("\n\n",attachments.stream().limit(12).toList()));
        }
        return summary.toString();
    }

    private List<String> representative(List<String> passages,int limit) {
        if(passages.size()<=limit) return passages;
        var result=new java.util.ArrayList<String>(limit);
        for(int index=0;index<limit;index++) result.add(passages.get(index*(passages.size()-1)/(limit-1)));
        return result;
    }

    private String mockInfographic(String title,List<String> passages) {
        var pages=new java.util.ArrayList<Map<String,Object>>();
        int pageCount=Math.min(3,Math.max(1,(passages.size()+3)/4));
        for(int page=0;page<pageCount;page++) {
            int from=page*4,to=Math.min(passages.size(),from+4);
            var nodes=new java.util.ArrayList<Map<String,String>>();
            for(int index=from;index<to;index++) {
                String detail=MockStudyContent.clip(passages.get(index),180);
                String label=detail.length()>28?detail.substring(0,28).stripTrailing()+"…":detail;
                String icon=detail.matches(".*(보안|기밀|권한|접근).*")?"shield":detail.matches(".*(데이터|정보).*")?"data":"idea";
                nodes.add(Map.of("label",label,"detail",detail,"icon",icon));
            }
            while(nodes.size()<2) nodes.add(Map.of("label","핵심 개념","detail",MockStudyContent.clip(passages.isEmpty()?title:passages.getFirst(),180),"icon","idea"));
            pages.add(Map.of("title",page==0?title:passages.get(from).substring(0,Math.min(38,passages.get(from).length())),
                    "subtitle","","relation","","layout","group","nodes",nodes));
        }
        try { return json.writeValueAsString(Map.of("pages",pages)); }
        catch(Exception failure) { throw new IllegalStateException("인포그래픽 미리보기를 만들지 못했습니다.",failure); }
    }

    private String sourcePreview(List<Source> sources) {
        if(sources.isEmpty()) return "## 포함한 강의자료\n\n없음";
        var result=new StringBuilder("## 포함한 강의자료\n");
        for(Source source:sources) {
            String text=source.text().strip(); if(text.length()>800) text=text.substring(0,800)+"…";
            result.append("\n### ").append(source.name()).append("\n\n").append(text).append("\n");
        }
        return result.toString();
    }

    private void fail(String jobId,long userId,String code) {
        db.update("update generation_jobs set status='FAILED',completed_at=current_timestamp,error_code=? where id=? and user_id=? and status='RUNNING'",code,jobId,userId);
    }

    private record JobOwner(String id,long userId) {}
    private record Input(String kind,long version,String model,String title,String body) {}
    private record Source(String name,String text) {}
    private record MindNode(String label,List<MindNode> children) {}
    private static final class GenerationFailure extends RuntimeException {
        private final String code;
        private GenerationFailure(String code) { this.code=code; }
    }
}
