package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
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

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class FlashcardController {
    private static final List<String> MOCK_CARD_TYPES=List.of("DEFINITION","MECHANISM","APPLICATION","CAUSE_EFFECT","COMPARISON","PROCESS");
    private final JdbcTemplate db; private final TransactionTemplate tx; private final GeminiGenerator gemini; private final UsageRecorder usage; private final String model; private final boolean mockEnabled; private final AuthSupport authSupport;
    public FlashcardController(JdbcTemplate db,TransactionTemplate tx,GeminiGenerator gemini,UsageRecorder usage,
                               @Value("${studyspace.ai.model:gemini-3.6-flash}") String model,
                               @Value("${studyspace.ai.mock-enabled:true}") boolean mockEnabled,AuthSupport authSupport){this.db=db;this.tx=tx;this.gemini=gemini;this.usage=usage;this.model=model;this.mockEnabled=mockEnabled;this.authSupport=authSupport;}
    public record CreateDeck(@NotNull @Pattern(regexp="[a-fA-F0-9-]{36}") String requestId,@Min(3) @Max(20) int cardCount,
                             @Size(max=10) List<@Pattern(regexp="[A-Za-z0-9-]{1,64}") String> attachmentIds,
                             @Pattern(regexp="[a-fA-F0-9-]{36}") String artifactId){}
    public record Review(@NotNull @Pattern(regexp="[a-fA-F0-9-]{36}") String requestId,@NotNull @Pattern(regexp="KNOWN|AGAIN") String rating){}
    public record CardInput(@NotBlank @Size(max=1000) String front,@NotBlank @Size(max=4000) String back,
                            @NotNull @Size(max=2000) String explanation,@Pattern(regexp="[A-Z_]{3,30}") String type){}
    public record Card(String id,int order,String type,String front,String back,String explanation,String source,String lastRating,String nextReviewAt){}
    public record Deck(String id,String courseId,String noteId,String title,long sourceNoteVersion,List<String> sourceAttachmentIds,boolean mockResult,int cardCount,String createdAt,List<Card> cards){}
    public record ReviewResult(String rating,String nextReviewAt){}
    private long owner(Authentication auth){return Long.parseLong(auth.getName());}

    @PostMapping("/notes/{noteId}/flashcard-decks") @ResponseStatus(HttpStatus.CREATED)
    public Deck create(Authentication auth,@PathVariable String noteId,@Valid @RequestBody CreateDeck input){
        long user=owner(auth);var replay=byRequest(input.requestId(),user);if(!replay.isEmpty())return deck(replay.getFirst(),user,true);
        if(!mockEnabled && !Boolean.TRUE.equals(db.queryForObject("select email_verified from users where id=?",Boolean.class,user))) throw new AuthException("이메일 인증 후 AI 생성을 이용할 수 있습니다.",403);
        var notes=db.query("select n.course_id,n.title,n.body,n.version from notes n where n.id=? and n.user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)",(row,index)->new Note(row.getString("course_id"),row.getString("title"),row.getString("body"),row.getLong("version")),noteId,user);
        if(notes.isEmpty())throw new AuthException("노트를 찾을 수 없습니다.",404);Note note=notes.getFirst();List<AttachmentSource> attachments=requireAttachments(input.attachmentIds(),noteId,user);ReviewSource review=input.artifactId()==null?null:requireReviewSource(input.artifactId(),note.courseId(),user);String id=UUID.randomUUID().toString();
        boolean mock=mockEnabled; List<GeminiGenerator.GeneratedCard> generatedResult=List.of();
        if(!mock) {
            try { GeminiGenerator.CardResult result=gemini.generateFlashcards(model,source(note,attachments,review),input.cardCount()); generatedResult=result.cards(); usage.record(user,"FLASHCARD",model,result.promptTokens(),result.outputTokens()); }
            catch(GeminiGenerator.Failure failure) { throw new AuthException(failure.userMessage(),503); }
        }
        final List<GeminiGenerator.GeneratedCard> generated=generatedResult;
        String sourceAttachmentIds=String.join(",",attachments.stream().map(AttachmentSource::id).sorted().toList());
        try{tx.executeWithoutResult(status->{db.update("insert into flashcard_decks(id,request_id,user_id,course_id,note_id,title,source_note_version,source_attachment_ids,mock_result) values(?,?,?,?,?,?,?,?,?)",id,input.requestId(),user,note.courseId(),noteId,"플래시카드 · "+note.title(),note.version(),sourceAttachmentIds,mock);if(mock)for(int i=0;i<input.cardCount();i++)insertCard(id,i,note,attachments,review);else for(int i=0;i<generated.size();i++)insertGeneratedCard(id,i,generated.get(i));});}
        catch(DuplicateKeyException duplicate){var existing=byRequest(input.requestId(),user);if(existing.isEmpty())throw new AuthException("덱 생성 요청을 다시 시도해 주세요.",409);return deck(existing.getFirst(),user,true);}return deck(id,user,true);
    }
    @GetMapping("/courses/{courseId}/flashcard-decks")
    public List<Deck> list(Authentication auth,@PathVariable String courseId){long user=owner(auth);authSupport.requireCourse(courseId,user);return db.query("select id from flashcard_decks where course_id=? and user_id=? order by created_at desc",(row,index)->deck(row.getString("id"),user,false),courseId,user);}
    @GetMapping("/flashcard-decks/{id}") public Deck get(Authentication auth,@PathVariable String id){return deck(id,owner(auth),true);}
    @PostMapping("/flashcard-decks/{id}/cards") @ResponseStatus(HttpStatus.CREATED)
    public Deck addCard(Authentication auth,@PathVariable String id,@Valid @RequestBody CardInput input){
        long user=owner(auth);requireDeck(id,user);Integer next=db.queryForObject("select coalesce(max(card_order),-1)+1 from flashcards where deck_id=?",Integer.class,id);
        db.update("insert into flashcards(id,deck_id,card_order,front_text,back_text,explanation,source_label,card_type) values(?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),id,next,input.front().strip(),input.back().strip(),input.explanation().strip(),"사용자가 추가한 카드",cardType(input.type()));
        return deck(id,user,true);
    }
    @PatchMapping("/flashcards/{id}")
    public Deck updateCard(Authentication auth,@PathVariable String id,@Valid @RequestBody CardInput input){
        long user=owner(auth);String deck=requireCard(id,user);
        db.update("update flashcards set front_text=?,back_text=?,explanation=?,card_type=? where id=?",input.front().strip(),input.back().strip(),input.explanation().strip(),cardType(input.type()),id);
        return deck(deck,user,true);
    }
    @DeleteMapping("/flashcards/{id}")
    public Deck deleteCard(Authentication auth,@PathVariable String id){long user=owner(auth);String deck=requireCard(id,user);db.update("delete from flashcards where id=?",id);return deck(deck,user,true);}
    @PostMapping("/flashcards/{id}/reviews")
    public ReviewResult review(Authentication auth,@PathVariable String id,@Valid @RequestBody Review input){
        long user=owner(auth);
        var replay=db.query("select rating,next_review_at from flashcard_reviews where request_id=? and user_id=?",(row,index)->new ReviewResult(row.getString("rating"),row.getTimestamp("next_review_at").toInstant().toString()),input.requestId(),user);
        if(!replay.isEmpty())return replay.getFirst();
        var cards=db.query("select c.repetition,c.interval_days from flashcards c join flashcard_decks d on d.id=c.deck_id where c.id=? and d.user_id=?",(row,index)->new CardState(row.getInt("repetition"),row.getInt("interval_days")),id,user);
        if(cards.isEmpty())throw new AuthException("카드를 찾을 수 없습니다.",404);
        CardState state=cards.getFirst();
        boolean known="KNOWN".equals(input.rating());
        int repetition=known?state.repetition()+1:0;
        int intervalDays=known?intervalDays(repetition):1;
        Instant next=Instant.now().plus(intervalDays,ChronoUnit.DAYS);
        try{
            db.update("update flashcards set repetition=?,interval_days=? where id=?",repetition,intervalDays,id);
            db.update("insert into flashcard_reviews(id,request_id,user_id,card_id,rating,next_review_at) values(?,?,?,?,?,?)",UUID.randomUUID().toString(),input.requestId(),user,id,input.rating(),java.sql.Timestamp.from(next));
        }catch(DuplicateKeyException ignored){return review(auth,id,input);}
        return new ReviewResult(input.rating(),next.toString());
    }

    private static int intervalDays(int repetition) {
        return switch(repetition) { case 1 -> 1; case 2 -> 3; case 3 -> 7; case 4 -> 14; case 5 -> 30; default -> 60; };
    }

    private void insertCard(String deck,int order,Note note,List<AttachmentSource> attachments,ReviewSource review) {
        String basis=review==null
                ?String.join("\n",java.util.stream.Stream.concat(java.util.stream.Stream.of(note.body()),attachments.stream().map(AttachmentSource::text)).toList())
                :review.content();
        List<String> passages=MockStudyContent.cardPassages(basis);
        if(passages.isEmpty()) passages=List.of(note.title()+" 노트의 핵심 내용을 설명해 보세요.");
        String claim=passages.get(order%passages.size());
        String type=mockCardType(claim,order);
        String subject=MockStudyContent.subject(claim);
        String front=mockFront(type,subject);
        String back=MockStudyContent.clip(claim,360);
        String sourceLabel=review==null
                ?"노트 `"+note.title()+"` 버전 "+note.version()+(attachments.isEmpty()?"":" · 첨부자료 포함")
                :"요점 정리 `"+review.title()+"` · 노트 `"+note.title()+"`";
        String explanation="자료의 근거를 "+mockTypeLabel(type)+" 관점에서 다시 확인하세요. 원문 핵심: "+back;
        db.update("insert into flashcards(id,deck_id,card_order,front_text,back_text,explanation,source_label,card_type) values(?,?,?,?,?,?,?,?)",
                UUID.randomUUID().toString(),deck,order,front,back,explanation,sourceLabel,type);
    }
    private void insertGeneratedCard(String deck,int order,GeminiGenerator.GeneratedCard card){db.update("insert into flashcards(id,deck_id,card_order,front_text,back_text,explanation,source_label,card_type) values(?,?,?,?,?,?,?,?)",UUID.randomUUID().toString(),deck,order,card.front(),card.back(),card.explanation(),card.source(),card.type());}
    private String source(Note note,List<AttachmentSource> attachments,ReviewSource review){
        var source=new StringBuilder();
        if(review!=null) source.append("[우선 출제 원본 · 요점 정리] ").append(review.title()).append("\n").append(review.content()).append("\n\n");
        source.append("[사실 확인용 노트] ").append(note.title()).append("\n버전: ").append(note.version()).append("\n").append(note.body());
        for(AttachmentSource attachment:attachments) source.append("\n\n[사실 확인용 자료] ").append(attachment.name()).append("\n").append(attachment.text());
        return source.toString();
    }
    private ReviewSource requireReviewSource(String id,String courseId,long user){var rows=db.query("select a.id,a.title,a.content from learning_artifacts a join notes n on n.id=a.note_id and n.user_id=a.user_id where a.id=? and a.user_id=? and n.course_id=? and a.kind in ('SUMMARY','AI_NOTE')",(row,index)->new ReviewSource(row.getString("id"),row.getString("title"),row.getString("content")),id,user,courseId);if(rows.isEmpty())throw new AuthException("현재 과목의 요점 정리 또는 AI 노트만 카드 원본으로 선택할 수 있습니다.",400);return rows.getFirst();}
    private List<AttachmentSource> requireAttachments(List<String> ids,String noteId,long user){if(ids==null||ids.isEmpty())return List.of();if(new HashSet<>(ids).size()!=ids.size())throw new AuthException("같은 자료를 중복 선택할 수 없습니다.",400);var result=new ArrayList<AttachmentSource>();for(String id:ids){var rows=db.query("select id,original_name,extracted_text from attachments where id=? and note_id=? and user_id=? and analysis_status='TEXT_READY' and extracted_text is not null",(row,index)->new AttachmentSource(row.getString("id"),row.getString("original_name"),row.getString("extracted_text")),id,noteId,user);if(rows.isEmpty())throw new AuthException("분석이 완료된 현재 노트의 자료만 포함할 수 있습니다.",400);result.add(rows.getFirst());}return result;}
    private Deck deck(String id,long user,boolean includeCards){var rows=db.query("select d.*,(select count(*) from flashcards c where c.deck_id=d.id) card_count from flashcard_decks d where d.id=? and d.user_id=?",(row,index)->new DeckBase(row.getString("id"),row.getString("course_id"),row.getString("note_id"),row.getString("title"),row.getLong("source_note_version"),row.getString("source_attachment_ids"),row.getBoolean("mock_result"),row.getInt("card_count"),row.getTimestamp("created_at").toInstant().toString()),id,user);if(rows.isEmpty())throw new AuthException("플래시카드 덱을 찾을 수 없습니다.",404);var base=rows.getFirst();List<Card> cards=includeCards?db.query("select c.*,(select r.rating from flashcard_reviews r where r.card_id=c.id and r.user_id=? order by r.reviewed_at desc limit 1) last_rating,(select r.next_review_at from flashcard_reviews r where r.card_id=c.id and r.user_id=? order by r.reviewed_at desc limit 1) next_review from flashcards c where c.deck_id=? order by c.card_order",(row,index)->new Card(row.getString("id"),row.getInt("card_order"),cardType(row.getString("card_type")),row.getString("front_text"),row.getString("back_text"),row.getString("explanation"),row.getString("source_label"),row.getString("last_rating"),row.getTimestamp("next_review")==null?null:row.getTimestamp("next_review").toInstant().toString()),user,user,id):List.of();List<String> sources=base.sourceIds()==null||base.sourceIds().isBlank()?List.of():java.util.Arrays.stream(base.sourceIds().split(",")).filter(value->!value.isBlank()).sorted().toList();return new Deck(base.id(),base.courseId(),base.noteId(),base.title(),base.version(),sources,base.mock(),base.count(),base.created(),cards);}
    private List<String> byRequest(String request,long user){return db.queryForList("select id from flashcard_decks where request_id=? and user_id=?",String.class,request,user);}
    private void requireDeck(String id,long user){Integer count=db.queryForObject("select count(*) from flashcard_decks where id=? and user_id=?",Integer.class,id,user);if(count==null||count!=1)throw new AuthException("플래시카드 덱을 찾을 수 없습니다.",404);}
    private String requireCard(String id,long user){var decks=db.queryForList("select d.id from flashcards c join flashcard_decks d on d.id=c.deck_id where c.id=? and d.user_id=?",String.class,id,user);if(decks.isEmpty())throw new AuthException("카드를 찾을 수 없습니다.",404);return decks.getFirst();}
    private static String cardType(String value){return value==null||value.isBlank()?"CUSTOM":value;}
    private static String mockCardType(String claim,int order){
        String lower=claim.toLowerCase();
        if(lower.matches(".*(반면|차이|비교|구분|대조).*")) return "COMPARISON";
        if(lower.matches(".*(때문|원인|결과|따라서|영향|유발).*")) return "CAUSE_EFFECT";
        if(lower.matches(".*(과정|단계|순서|먼저|다음|절차).*")) return "PROCESS";
        if(lower.matches(".*(방법|사용|적용|상황|경우|조건).*")) return "APPLICATION";
        if(lower.matches(".*(작동|동작|흐름|구성|수행|처리).*")) return "MECHANISM";
        return MOCK_CARD_TYPES.get(order%MOCK_CARD_TYPES.size());
    }
    private static String mockFront(String type,String subject){
        String concept=subject==null||subject.isBlank()?"이 개념":subject;
        return switch(type){
            case "MECHANISM" -> concept+"이 작동하는 방식이나 핵심 역할은 무엇인가요?";
            case "COMPARISON" -> concept+"과 관련 개념을 구분할 때 핵심 차이는 무엇인가요?";
            case "CAUSE_EFFECT" -> concept+"의 원인과 결과 또는 영향은 어떻게 연결되나요?";
            case "APPLICATION" -> concept+"의 원리를 실제 상황에 적용할 때 기억할 기준은 무엇인가요?";
            case "PROCESS" -> concept+"과 관련해 기억해야 할 절차나 순서는 무엇인가요?";
            default -> concept+"의 의미와 핵심 특징을 한 문장으로 설명하면 무엇인가요?";
        };
    }
    private static String mockTypeLabel(String type){
        return switch(type){case "DEFINITION"->"정의";case "MECHANISM"->"작동 원리";case "COMPARISON"->"비교";case "CAUSE_EFFECT"->"원인·결과";case "APPLICATION"->"적용";case "PROCESS"->"절차";default->"핵심 내용";};
    }
    private record Note(String courseId,String title,String body,long version){}
    private record AttachmentSource(String id,String name,String text){}
    private record ReviewSource(String id,String title,String content){}
    private record DeckBase(String id,String courseId,String noteId,String title,long version,String sourceIds,boolean mock,int count,String created){}
    private record CardState(int repetition,int intervalDays){}
}
