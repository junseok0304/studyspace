package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api")
public class DashboardController {
    private final JdbcTemplate db;
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    public DashboardController(JdbcTemplate db) { this.db = db; }
    public record Day(String date, int count) {}
    public record CourseSummary(String id, String name, String semester, int notes, int viewed) {}
    public record Recent(String id, String courseId, String title, String courseName) {}
    public record TodayClass(String courseId, String name, String semester, String start, String end, String room) {}
    public record Dashboard(int courses, int notes, int viewed, int activeDays, List<Day> days,
                            List<CourseSummary> courseStats, List<Recent> recent, List<TodayClass> todayClasses,
                            int quizAttempts,Double quizAccuracy,int wrongAnswers,int flashcardsDue,
                            Recent quizTarget,Recent reviewTarget) {}
    private static final Pattern SCHEDULE = Pattern.compile("([월화수목금토일])요일?\\s*/\\s*(\\d{1,2}:\\d{2})\\s*~\\s*(\\d{1,2}:\\d{2})(?:\\s*/\\s*([^,]+))?");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("H:mm");
    private static final DateTimeFormatter DISPLAY_TIME = DateTimeFormatter.ofPattern("HH:mm");

    @PostMapping("/notes/{id}/activity")
    public Map<String, Boolean> activity(Authentication auth, @PathVariable String id) {
        long user = Long.parseLong(auth.getName());
        if (db.queryForObject("select count(*) from notes n where id=? and user_id=? and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)", Integer.class,id,user) != 1)
            throw new AuthException("노트를 찾을 수 없습니다.",404);
        try {
            db.update("insert into note_activity(user_id,note_id,activity_date) values(?,?,?)",user,id,LocalDate.now(ZONE));
        } catch (DuplicateKeyException ignored) { /* One note per day, even across tabs. */ }
        return Map.of("recorded",true);
    }

    @GetMapping("/dashboard")
    public Dashboard dashboard(Authentication auth, @RequestParam(defaultValue="") String semester) {
        long user = Long.parseLong(auth.getName());
        var stats = db.query("""
            select c.id,c.name,c.semester,count(n.id) as notes,
              sum(case when exists(select 1 from note_activity a where a.note_id=n.id and a.user_id=?) then 1 else 0 end) as viewed
            from courses c left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            left join notes n on n.course_id=c.id and n.user_id=c.user_id and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)
            where c.user_id=? and coalesce(s.archived,false)=false and (?='' or c.semester=?)
            group by c.id,c.name,c.semester order by c.semester desc,c.name
            """, (r,n) -> new CourseSummary(r.getString("id"),r.getString("name"),r.getString("semester"),r.getInt("notes"),r.getInt("viewed")),user,user,semester,semester);
        LocalDate today = LocalDate.now(ZONE);
        Map<LocalDate,Integer> counts = new HashMap<>();
        db.query("""
            select a.activity_date,count(*) as total from note_activity a
            join notes n on n.id=a.note_id and n.user_id=a.user_id join courses c on c.id=n.course_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            where a.user_id=? and coalesce(s.archived,false)=false and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id) and a.activity_date between ? and ? and (?='' or c.semester=?)
            group by a.activity_date
            """, r -> { counts.put(r.getDate("activity_date").toLocalDate(),r.getInt("total")); },user,today.minusDays(6),today,semester,semester);
        var days = new ArrayList<Day>();
        for(int i=6;i>=0;i--) { var date=today.minusDays(i); days.add(new Day(date.toString(),counts.getOrDefault(date,0))); }
        var recent = db.query("""
            select n.id,n.course_id,n.title,c.name from notes n join courses c on c.id=n.course_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            where n.user_id=? and coalesce(s.archived,false)=false and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id) and (?='' or c.semester=?) order by n.updated_at desc,n.id limit 4
            """, (r,n) -> new Recent(r.getString("id"),r.getString("course_id"),r.getString("title"),r.getString("name")),user,semester,semester);
        var latestQuizNote = db.query("""
            select n.id,n.course_id,n.title,c.name from quiz_attempts a
            join quiz_sets q on q.id=a.quiz_set_id and q.user_id=a.user_id
            join notes n on n.id=q.note_id and n.user_id=q.user_id
            join courses c on c.id=q.course_id and c.user_id=q.user_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            where a.user_id=? and a.status='COMPLETED' and coalesce(s.archived,false)=false
              and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)
              and (?='' or c.semester=?)
            order by a.completed_at desc,a.id desc limit 1
            """,(r,n)->new Recent(r.getString("id"),r.getString("course_id"),r.getString("title"),r.getString("name")),user,semester,semester);
        Recent quizTarget=latestQuizNote.isEmpty()?(recent.isEmpty()?null:recent.getFirst()):latestQuizNote.getFirst();
        String todayName = switch (today.getDayOfWeek()) {
            case MONDAY -> "월"; case TUESDAY -> "화"; case WEDNESDAY -> "수"; case THURSDAY -> "목";
            case FRIDAY -> "금"; case SATURDAY -> "토"; case SUNDAY -> "일";
        };
        var todayClasses = new ArrayList<TodayClass>();
        db.query("""
            select c.id,c.name,c.semester,s.schedule from school_courses s join courses c on c.id=s.course_id
            left join course_settings cs on cs.course_id=c.id and cs.user_id=c.user_id
            where s.user_id=? and c.user_id=? and coalesce(cs.archived,false)=false and (?='' or c.semester=?)
            """, row -> {
            var matcher=SCHEDULE.matcher(row.getString("schedule"));
            while(matcher.find()) {
                if(!todayName.equals(matcher.group(1))) continue;
                try {
                    String start=LocalTime.parse(matcher.group(2),TIME).format(DISPLAY_TIME);
                    String end=LocalTime.parse(matcher.group(3),TIME).format(DISPLAY_TIME);
                    todayClasses.add(new TodayClass(row.getString("id"),row.getString("name"),row.getString("semester"),start,end,matcher.group(4)==null?"":matcher.group(4).strip()));
                } catch (DateTimeException ignored) { /* Ignore one malformed school schedule slot. */ }
            }
        },user,user,semester,semester);
        todayClasses.sort(Comparator.comparing(TodayClass::start).thenComparing(TodayClass::name));
        var quiz=db.query("""
            select count(*) attempts,coalesce(sum(a.correct_answers),0) correct_total,coalesce(sum(a.total_questions),0) question_total,
              coalesce(sum(a.total_questions-a.correct_answers),0) wrong_total
            from quiz_attempts a join quiz_sets q on q.id=a.quiz_set_id join courses c on c.id=q.course_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            join notes n on n.id=q.note_id and n.user_id=q.user_id
            where a.user_id=? and a.status='COMPLETED' and coalesce(s.archived,false)=false
              and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)
              and (?='' or c.semester=?)
            """,(row,index)->new QuizStats(row.getInt("attempts"),row.getInt("correct_total"),row.getInt("question_total"),row.getInt("wrong_total")),user,semester,semester).getFirst();
        Double accuracy=quiz.questions()==0?null:Math.round(quiz.correct()*1000.0/quiz.questions())/10.0;
        java.sql.Timestamp reviewBefore=java.sql.Timestamp.valueOf(today.plusDays(1).atStartOfDay());
        Integer flashcardsDue=db.queryForObject("""
            select count(*) from flashcards f join flashcard_decks d on d.id=f.deck_id
            join courses c on c.id=d.course_id and c.user_id=d.user_id
            join notes n on n.id=d.note_id and n.user_id=d.user_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            where d.user_id=? and coalesce(s.archived,false)=false
              and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)
              and (?='' or c.semester=?) and (
              not exists(select 1 from flashcard_reviews r where r.card_id=f.id and r.user_id=d.user_id)
              or (select r.next_review_at from flashcard_reviews r where r.card_id=f.id and r.user_id=d.user_id order by r.reviewed_at desc limit 1) < ?)
            """,Integer.class,user,semester,semester,reviewBefore);
        var dueNotes=db.query("""
            select n.id,n.course_id,n.title,c.name from flashcards f
            join flashcard_decks d on d.id=f.deck_id and d.user_id=?
            join notes n on n.id=d.note_id and n.user_id=d.user_id
            join courses c on c.id=d.course_id and c.user_id=d.user_id
            left join course_settings s on s.course_id=c.id and s.user_id=c.user_id
            where coalesce(s.archived,false)=false
              and not exists(select 1 from note_trash t where t.note_id=n.id and t.user_id=n.user_id)
              and (?='' or c.semester=?) and (
                not exists(select 1 from flashcard_reviews r where r.card_id=f.id and r.user_id=d.user_id)
                or (select r.next_review_at from flashcard_reviews r where r.card_id=f.id and r.user_id=d.user_id order by r.reviewed_at desc limit 1) < ?)
            order by d.created_at desc,d.id desc limit 1
            """,(r,n)->new Recent(r.getString("id"),r.getString("course_id"),r.getString("title"),r.getString("name")),user,semester,semester,reviewBefore);
        Recent reviewTarget=dueNotes.isEmpty()?null:dueNotes.getFirst();
        return new Dashboard(stats.size(),stats.stream().mapToInt(CourseSummary::notes).sum(),
                stats.stream().mapToInt(CourseSummary::viewed).sum(),counts.size(),days,stats,recent,todayClasses,quiz.attempts(),accuracy,quiz.wrong(),flashcardsDue==null?0:flashcardsDue,quizTarget,reviewTarget);
    }
    private record QuizStats(int attempts,int correct,int questions,int wrong) {}
}
