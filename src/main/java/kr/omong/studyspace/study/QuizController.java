package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class QuizController {
    private final JdbcTemplate db; private final TransactionTemplate tx; private final GeminiGenerator gemini; private final UsageRecorder usage; private final String model; private final boolean mockEnabled; private final AuthSupport authSupport;
    public QuizController(JdbcTemplate db,TransactionTemplate tx,GeminiGenerator gemini,UsageRecorder usage,
                          @Value("${studyspace.ai.model:gemini-3.6-flash}") String model,
                          @Value("${studyspace.ai.mock-enabled:true}") boolean mockEnabled,AuthSupport authSupport) {
        this.db=db; this.tx=tx; this.gemini=gemini; this.usage=usage; this.model=model; this.mockEnabled=mockEnabled;this.authSupport=authSupport;
    }

    public record CreateQuiz(@NotNull @Pattern(regexp="[a-fA-F0-9-]{36}") String requestId,@Min(3) @Max(10) int questionCount,
                             @Size(max=10) List<@Pattern(regexp="[A-Za-z0-9-]{1,64}") String> attachmentIds,
                             @Pattern(regexp="[a-fA-F0-9-]{36}") String artifactId) {}
    public record StartAttempt(@NotNull @Pattern(regexp="[a-fA-F0-9-]{36}") String requestId,String wrongFromAttemptId) {}
    public record SaveAnswer(@Min(0) @Max(3) int selectedIndex) {}
    public record EditQuestion(@NotBlank @Size(max=500) String prompt,@NotNull @Size(min=4,max=4) List<@NotBlank @Size(max=300) String> options,@Min(0) @Max(3) int correctIndex,@NotBlank @Size(max=1000) String explanation) {}
    public record QuizSet(String id,String courseId,String noteId,String title,long sourceNoteVersion,String sourceArtifactId,List<String> sourceAttachmentIds,boolean mockResult,int questionCount,String activeAttemptId,int completedAttempts,Double bestAccuracy,String createdAt) {}
    public record Question(String id,int order,String prompt,List<String> options,Integer selectedIndex,Boolean correct,Integer correctIndex,String hint,String explanation,String source) {}
    public record Attempt(String id,String quizSetId,String mode,String status,int totalQuestions,Integer correctAnswers,String startedAt,String completedAt,List<Question> questions) {}

    private long owner(Authentication auth) { return Long.parseLong(auth.getName()); }

    @PostMapping("/notes/{noteId}/quiz-sets")
    @ResponseStatus(HttpStatus.CREATED)
    public QuizSet create(Authentication auth,@PathVariable String noteId,@Valid @RequestBody CreateQuiz input) {
        long user=owner(auth); var replay=findSetByRequest(input.requestId(),user); if(!replay.isEmpty()) return replay.getFirst();
        if(!mockEnabled && !Boolean.TRUE.equals(db.queryForObject("select email_verified from users where id=?",Boolean.class,user))) throw new AuthException("이메일 인증 후 AI 생성을 이용할 수 있습니다.",403);
        var notes=db.query("select n.course_id,n.title,n.body,n.version from notes n where n.id=? and n.user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)",
                (row,index)->new Note(row.getString("course_id"),row.getString("title"),row.getString("body"),row.getLong("version")),noteId,user);
        if(notes.isEmpty()) throw new AuthException("노트를 찾을 수 없습니다.",404); Note note=notes.getFirst(); List<AttachmentSource> attachments=requireAttachments(input.attachmentIds(),noteId,user); ReviewSource review=input.artifactId()==null?null:requireReviewSource(input.artifactId(),note.courseId(),user); String id=UUID.randomUUID().toString();
        List<String> previousPrompts=previousPrompts(noteId,user);
        List<String> previousAnswers=previousAnswers(noteId,user);
        boolean mock=mockEnabled; List<GeminiGenerator.GeneratedQuiz> generatedResult=List.of();
        if(!mock) {
            try { GeminiGenerator.QuizResult result=gemini.generateQuiz(model,source(note,attachments,review),input.questionCount(),previousPrompts); generatedResult=result.questions(); usage.record(user,"QUIZ",model,result.promptTokens(),result.outputTokens()); }
            catch(GeminiGenerator.Failure failure) { throw new AuthException(failure.userMessage(),503); }
        }
        final List<GeminiGenerator.GeneratedQuiz> generated=generatedResult;
        String mockMaterial = review != null ? review.content() : String.join("\n",
                java.util.stream.Stream.concat(java.util.stream.Stream.of(note.body()),attachments.stream().map(AttachmentSource::text)).toList());
        List<String> mockPassages=MockStudyContent.passagesExcluding(note.title(),mockMaterial);
        if(mockPassages.isEmpty()) mockPassages=List.of(note.title()+" 노트에 작성된 내용을 확인해 주세요.");
        Set<String> previouslyUsedAnswers=previousAnswers.stream().map(QuizController::normalizedPrompt).collect(java.util.stream.Collectors.toSet());
        Set<String> previouslyUsedPrompts=previousPrompts.stream().map(QuizController::normalizedPrompt).collect(java.util.stream.Collectors.toSet());
        Set<String> uniqueMockPrompts=new HashSet<>(previouslyUsedPrompts);
        mockPassages=mockPassages.stream()
                .filter(passage->!previouslyUsedAnswers.contains(normalizedPrompt(MockStudyContent.clip(passage,280))))
                .filter(passage->uniqueMockPrompts.add(normalizedPrompt(mockQuestionPrompt(passage))))
                .toList();
        if(mock && mockPassages.size()<input.questionCount()) throw new AuthException("이 노트에서 새 퀴즈로 만들 다른 내용이 부족합니다. 노트나 강의자료에 내용을 더 추가해 주세요.",409);
        final List<String> sourcePassages=mockPassages;
        String sourceAttachmentIds=String.join(",",attachments.stream().map(AttachmentSource::id).sorted().toList());
        try { tx.executeWithoutResult(status->{
            db.update("insert into quiz_sets(id,request_id,user_id,course_id,note_id,title,source_note_version,source_artifact_id,source_attachment_ids,mock_result) values(?,?,?,?,?,?,?,?,?,?)",id,input.requestId(),user,note.courseId(),noteId,"퀴즈 · "+note.title(),note.version(),input.artifactId(),sourceAttachmentIds,mock);
            if(mock) for(int order=0;order<input.questionCount();order++) insertMockQuestion(id,order,note,sourcePassages);
            else for(int order=0;order<generated.size();order++) insertGeneratedQuestion(id,order,generated.get(order));
        }); } catch(DuplicateKeyException duplicate) { var existing=findSetByRequest(input.requestId(),user); if(existing.isEmpty()) throw new AuthException("퀴즈 생성 요청을 다시 시도해 주세요.",409); return existing.getFirst(); }
        return findSet(id,user);
    }

    @GetMapping("/courses/{courseId}/quiz-sets")
    public List<QuizSet> sets(Authentication auth,@PathVariable String courseId) {
        long user=owner(auth); authSupport.requireCourse(courseId,user);
        return db.query(setSelect()+" where s.course_id=? and s.user_id=? order by s.created_at desc",(row,index)->set(row),courseId,user);
    }

    @GetMapping("/quiz-sets/{setId}/attempts")
    public List<Attempt> attempts(Authentication auth,@PathVariable String setId) {
        long user=owner(auth);if(db.queryForObject("select count(*) from quiz_sets where id=? and user_id=?",Integer.class,setId,user)!=1)throw new AuthException("퀴즈를 찾을 수 없습니다.",404);
        return db.queryForList("select id from quiz_attempts where quiz_set_id=? and user_id=? and status='COMPLETED' order by completed_at desc limit 20",String.class,setId,user).stream().map(id->attempt(id,user,true)).toList();
    }

    @GetMapping("/quiz-sets/{setId}/questions")
    public List<Question> questions(Authentication auth,@PathVariable String setId) {
        long user=owner(auth); requireOwnedSet(setId,user);
        return db.query("select * from quiz_questions where quiz_set_id=? order by question_order",(row,index)->new Question(row.getString("id"),row.getInt("question_order"),row.getString("prompt"),List.of(row.getString("option_a"),row.getString("option_b"),row.getString("option_c"),row.getString("option_d")),null,null,row.getInt("correct_index"),row.getString("hint_text"),row.getString("explanation"),row.getString("source_label")),setId);
    }

    @PutMapping("/quiz-sets/{setId}/questions/{questionId}")
    public Question editQuestion(Authentication auth,@PathVariable String setId,@PathVariable String questionId,@Valid @RequestBody EditQuestion input) {
        long user=owner(auth); requireOwnedSet(setId,user);
        Integer attempts=db.queryForObject("select count(*) from quiz_attempts where quiz_set_id=?",Integer.class,setId);
        if(attempts!=null&&attempts>0) throw new AuthException("풀이를 시작한 퀴즈는 문항을 수정할 수 없습니다.",409);
        List<String> options=input.options().stream().map(String::strip).toList();
        int updated=db.update("update quiz_questions set prompt=?,option_a=?,option_b=?,option_c=?,option_d=?,correct_index=?,explanation=? where id=? and quiz_set_id=?",input.prompt().strip(),options.get(0),options.get(1),options.get(2),options.get(3),input.correctIndex(),input.explanation().strip(),questionId,setId);
        if(updated!=1) throw new AuthException("문항을 찾을 수 없습니다.",404);
        return questions(auth,setId).stream().filter(question->question.id().equals(questionId)).findFirst().orElseThrow();
    }

    @DeleteMapping("/quiz-sets/{setId}")
    public Map<String,Boolean> deleteSet(Authentication auth,@PathVariable String setId) {
        long user=owner(auth);if(db.update("delete from quiz_sets where id=? and user_id=?",setId,user)!=1)throw new AuthException("퀴즈를 찾을 수 없습니다.",404);return Map.of("deleted",true);
    }

    @PostMapping("/quiz-sets/{setId}/attempts")
    @ResponseStatus(HttpStatus.CREATED)
    public Attempt start(Authentication auth,@PathVariable String setId,@Valid @RequestBody StartAttempt input) {
        long user=owner(auth); var replay=findAttemptByRequest(input.requestId(),user); if(!replay.isEmpty()) return attempt(replay.getFirst(),user,false);
        if(db.queryForObject("select count(*) from quiz_sets where id=? and user_id=?",Integer.class,setId,user)!=1) throw new AuthException("퀴즈를 찾을 수 없습니다.",404);
        List<String> questions;
        String mode=input.wrongFromAttemptId()==null?"ALL":"WRONG";
        if("WRONG".equals(mode)) {
            questions=db.queryForList("select aq.question_id from quiz_attempt_questions aq join quiz_attempts a on a.id=aq.attempt_id left join quiz_answers an on an.attempt_id=a.id and an.question_id=aq.question_id where a.id=? and a.user_id=? and a.quiz_set_id=? and a.status='COMPLETED' and coalesce(an.correct,false)=false order by aq.question_order",String.class,input.wrongFromAttemptId(),user,setId);
            if(questions.isEmpty()) throw new AuthException("다시 풀 오답이 없습니다.",409);
        } else questions=db.queryForList("select id from quiz_questions where quiz_set_id=? order by question_order",String.class,setId);
        String id=UUID.randomUUID().toString();
        try { tx.executeWithoutResult(status->{
            db.update("insert into quiz_attempts(id,request_id,user_id,quiz_set_id,mode,source_attempt_id,status,total_questions) values(?,?,?,?,?,?,'IN_PROGRESS',?)",id,input.requestId(),user,setId,mode,input.wrongFromAttemptId(),questions.size());
            for(int order=0;order<questions.size();order++) db.update("insert into quiz_attempt_questions(attempt_id,question_id,question_order) values(?,?,?)",id,questions.get(order),order);
        }); } catch(DuplicateKeyException duplicate) { var existing=findAttemptByRequest(input.requestId(),user); if(existing.isEmpty()) throw new AuthException("풀이 시작 요청을 다시 시도해 주세요.",409); return attempt(existing.getFirst(),user,false); }
        return attempt(id,user,false);
    }

    @GetMapping("/quiz-attempts/{id}")
    public Attempt getAttempt(Authentication auth,@PathVariable String id) { long user=owner(auth); return attempt(id,user,isComplete(id,user)); }

    @PutMapping("/quiz-attempts/{attemptId}/answers/{questionId}")
    public Attempt answer(Authentication auth,@PathVariable String attemptId,@PathVariable String questionId,@Valid @RequestBody SaveAnswer input) {
        long user=owner(auth); requireInProgress(attemptId,user);
        var previous=db.queryForList("select selected_index from quiz_answers where attempt_id=? and question_id=?",Integer.class,attemptId,questionId);
        if(!previous.isEmpty()) {
            if(previous.getFirst()==input.selectedIndex()) return attempt(attemptId,user,false);
            throw new AuthException("이 문항은 이미 답을 제출해 채점이 끝났습니다.",409);
        }
        var correct=db.queryForList("select q.correct_index from quiz_attempt_questions aq join quiz_questions q on q.id=aq.question_id where aq.attempt_id=? and aq.question_id=?",Integer.class,attemptId,questionId);
        if(correct.isEmpty()) throw new AuthException("문항을 찾을 수 없습니다.",404); boolean value=correct.getFirst()==input.selectedIndex();
        try {
            db.update("insert into quiz_answers(attempt_id,question_id,selected_index,correct) values(?,?,?,?)",attemptId,questionId,input.selectedIndex(),value);
        } catch(DuplicateKeyException race) {
            var saved=db.queryForList("select selected_index from quiz_answers where attempt_id=? and question_id=?",Integer.class,attemptId,questionId);
            if(saved.isEmpty() || saved.getFirst()!=input.selectedIndex()) throw new AuthException("이 문항은 이미 답을 제출해 채점이 끝났습니다.",409);
        }
        return attempt(attemptId,user,false);
    }

    @PostMapping("/quiz-attempts/{id}/submit")
    public Attempt submit(Authentication auth,@PathVariable String id) {
        long user=owner(auth); if(isComplete(id,user)) return attempt(id,user,true); requireInProgress(id,user);
        Integer correct=db.queryForObject("select count(*) from quiz_attempt_questions aq join quiz_answers a on a.attempt_id=aq.attempt_id and a.question_id=aq.question_id where aq.attempt_id=? and a.correct=true",Integer.class,id);
        db.update("update quiz_attempts set status='COMPLETED',correct_answers=?,completed_at=current_timestamp where id=? and user_id=? and status='IN_PROGRESS'",correct,id,user);
        return attempt(id,user,true);
    }

    private void insertMockQuestion(String setId,int order,Note note,List<String> passages) {
        int passageIndex=order%passages.size();
        String claim=passages.get(passageIndex);
        String prompt=mockQuestionPrompt(claim);
        var distractors=passages.stream().filter(value->!value.equals(claim)).limit(3).collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        List<String> fallback=List.of("강의자료에서 근거를 찾을 수 없는 설명입니다.","원문에 포함되지 않은 내용입니다.","제공된 자료에서 확인되지 않는 주장입니다.");
        for(String value:fallback) { if(distractors.size()==3) break; if(!value.equals(claim)) distractors.add(value); }
        int answer=order%4; String[] options=new String[4]; options[answer]=MockStudyContent.clip(claim,280);
        for(int index=0,next=0;index<4;index++) if(index!=answer) options[index]=MockStudyContent.clip(distractors.get(next++),280);
        db.update("insert into quiz_questions(id,quiz_set_id,question_order,prompt,option_a,option_b,option_c,option_d,correct_index,hint_text,explanation,source_label) values(?,?,?,?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(),setId,order,prompt,options[0],options[1],options[2],options[3],answer,"정의만 외우기보다 이 개념의 특징과 원문에서 함께 설명한 조건을 비교해 보세요.","원문 근거: "+claim,"노트 `"+note.title()+"` 버전 "+note.version());
    }

    private String mockQuestionPrompt(String claim) {
        String topic=claim.split("[:：,，.。!?！？\\n]",2)[0].strip();
        if(topic.length()>42) topic=topic.substring(0,42).stripTrailing();
        if(topic.isBlank()) topic=MockStudyContent.clip(claim,42);
        return "‘"+topic+"’에 관한 설명으로 노트의 내용과 일치하는 것은 무엇인가요?";
    }

    private void insertGeneratedQuestion(String setId,int order,GeminiGenerator.GeneratedQuiz question) {
        var options=question.options();
        db.update("insert into quiz_questions(id,quiz_set_id,question_order,prompt,option_a,option_b,option_c,option_d,correct_index,hint_text,explanation,source_label) values(?,?,?,?,?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(),setId,order,question.prompt(),options.get(0),options.get(1),options.get(2),options.get(3),question.correctIndex(),question.hint(),question.explanation(),question.source());
    }

    private String source(Note note,List<AttachmentSource> attachments,ReviewSource review) {
        var source=new StringBuilder("노트: ").append(note.title()).append("\n버전: ").append(note.version()).append("\n").append(note.body());
        for(AttachmentSource attachment:attachments) source.append("\n\n자료: ").append(attachment.name()).append("\n").append(attachment.text());
        if(review!=null) source.append("\n\n선택한 요점 정리(퀴즈의 우선 원본): ").append(review.title()).append("\n").append(review.content());
        return source.toString();
    }
    private List<String> previousPrompts(String noteId,long user) {
        return db.queryForList("select q.prompt from quiz_questions q join quiz_sets s on s.id=q.quiz_set_id where s.note_id=? and s.user_id=? order by s.created_at desc,q.question_order",String.class,noteId,user);
    }
    private List<String> previousAnswers(String noteId,long user) {
        return db.queryForList("select case q.correct_index when 0 then q.option_a when 1 then q.option_b when 2 then q.option_c else q.option_d end from quiz_questions q join quiz_sets s on s.id=q.quiz_set_id where s.note_id=? and s.user_id=?",String.class,noteId,user);
    }
    private static String normalizedPrompt(String value) {
        return value==null?"":value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+","");
    }
    private ReviewSource requireReviewSource(String id,String courseId,long user) {
        var rows=db.query("select a.id,a.title,a.content from learning_artifacts a join notes n on n.id=a.note_id and n.user_id=a.user_id where a.id=? and a.user_id=? and n.course_id=? and a.kind in ('SUMMARY','AI_NOTE')",
                (row,index)->new ReviewSource(row.getString("id"),row.getString("title"),row.getString("content")),id,user,courseId);
        if(rows.isEmpty()) throw new AuthException("현재 과목의 요점 정리 또는 AI 노트만 출제 원본으로 선택할 수 있습니다.",400);
        return rows.getFirst();
    }
    private List<AttachmentSource> requireAttachments(List<String> ids,String noteId,long user) {
        if(ids==null || ids.isEmpty()) return List.of();
        if(new HashSet<>(ids).size()!=ids.size()) throw new AuthException("같은 자료를 중복 선택할 수 없습니다.",400);
        var result=new ArrayList<AttachmentSource>();
        for(String id:ids) {
            var rows=db.query("select id,original_name,extracted_text from attachments where id=? and note_id=? and user_id=? and analysis_status='TEXT_READY' and extracted_text is not null",
                    (row,index)->new AttachmentSource(row.getString("id"),row.getString("original_name"),row.getString("extracted_text")),id,noteId,user);
            if(rows.isEmpty()) throw new AuthException("분석이 완료된 현재 노트의 자료만 포함할 수 있습니다.",400);
            result.add(rows.getFirst());
        }
        return result;
    }

    private Attempt attempt(String id,long user,boolean reveal) {
        var attempts=db.query("select * from quiz_attempts where id=? and user_id=?",(row,index)->new AttemptBase(row.getString("id"),row.getString("quiz_set_id"),row.getString("mode"),row.getString("status"),row.getInt("total_questions"),(Integer)row.getObject("correct_answers"),row.getTimestamp("started_at").toInstant().toString(),row.getTimestamp("completed_at")==null?null:row.getTimestamp("completed_at").toInstant().toString()),id,user);
        if(attempts.isEmpty()) throw new AuthException("풀이 기록을 찾을 수 없습니다.",404); AttemptBase base=attempts.getFirst(); boolean show=reveal||"COMPLETED".equals(base.status());
        var questions=db.query("select q.*,aq.question_order attempt_order,a.selected_index,a.correct from quiz_attempt_questions aq join quiz_questions q on q.id=aq.question_id left join quiz_answers a on a.attempt_id=aq.attempt_id and a.question_id=q.id where aq.attempt_id=? order by aq.question_order",(row,index)->{
            boolean revealAnswer=show||row.getObject("selected_index")!=null;
            return new Question(row.getString("id"),row.getInt("attempt_order"),row.getString("prompt"),List.of(row.getString("option_a"),row.getString("option_b"),row.getString("option_c"),row.getString("option_d")),(Integer)row.getObject("selected_index"),revealAnswer?(Boolean)row.getObject("correct"):null,revealAnswer?row.getInt("correct_index"):null,row.getString("hint_text"),revealAnswer?row.getString("explanation"):null,row.getString("source_label"));
        },id);
        return new Attempt(base.id(),base.setId(),base.mode(),base.status(),base.total(),base.correct(),base.started(),base.completed(),questions);
    }
    private boolean isComplete(String id,long user) { Integer count=db.queryForObject("select count(*) from quiz_attempts where id=? and user_id=? and status='COMPLETED'",Integer.class,id,user); return count!=null&&count==1; }
    private void requireOwnedSet(String id,long user) { Integer count=db.queryForObject("select count(*) from quiz_sets where id=? and user_id=?",Integer.class,id,user); if(count==null||count!=1) throw new AuthException("퀴즈를 찾을 수 없습니다.",404); }
    private void requireInProgress(String id,long user) { Integer count=db.queryForObject("select count(*) from quiz_attempts where id=? and user_id=? and status='IN_PROGRESS'",Integer.class,id,user); if(count==null||count!=1) throw new AuthException("진행 중인 풀이를 찾을 수 없습니다.",404); }
    private String setSelect(){return "select s.*,(select count(*) from quiz_questions q where q.quiz_set_id=s.id) question_count,(select min(a.id) from quiz_attempts a where a.quiz_set_id=s.id and a.user_id=s.user_id and a.status='IN_PROGRESS') active_attempt_id,(select count(*) from quiz_attempts a where a.quiz_set_id=s.id and a.user_id=s.user_id and a.status='COMPLETED') completed_attempts,(select max(a.correct_answers*100.0/nullif(a.total_questions,0)) from quiz_attempts a where a.quiz_set_id=s.id and a.user_id=s.user_id and a.status='COMPLETED') best_accuracy from quiz_sets s";}
    private QuizSet findSet(String id,long user){return db.queryForObject(setSelect()+" where s.id=? and s.user_id=?",(row,index)->set(row),id,user);}
    private List<QuizSet> findSetByRequest(String request,long user){return db.query(setSelect()+" where s.request_id=? and s.user_id=?",(row,index)->set(row),request,user);}
    private QuizSet set(java.sql.ResultSet row)throws java.sql.SQLException{Double best=row.getObject("best_accuracy")==null?null:Math.round(row.getDouble("best_accuracy")*10.0)/10.0;String stored=row.getString("source_attachment_ids");List<String> sources=stored==null||stored.isBlank()?List.of():java.util.Arrays.stream(stored.split(",")).filter(value->!value.isBlank()).sorted().toList();return new QuizSet(row.getString("id"),row.getString("course_id"),row.getString("note_id"),row.getString("title"),row.getLong("source_note_version"),row.getString("source_artifact_id"),sources,row.getBoolean("mock_result"),row.getInt("question_count"),row.getString("active_attempt_id"),row.getInt("completed_attempts"),best,row.getTimestamp("created_at").toInstant().toString());}
    private List<String> findAttemptByRequest(String request,long user){return db.queryForList("select id from quiz_attempts where request_id=? and user_id=?",String.class,request,user);}
    private record Note(String courseId,String title,String body,long version){}
    private record AttachmentSource(String id,String name,String text){}
    private record ReviewSource(String id,String title,String content){}
    private record AttemptBase(String id,String setId,String mode,String status,int total,Integer correct,String started,String completed){}
}
