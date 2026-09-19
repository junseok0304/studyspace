package kr.omong.studyspace.study;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import kr.omong.studyspace.auth.AuthException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.ObjectMapper;
import java.util.*;

@RestController
@RequestMapping("/api/school")
public class SchoolController {
    private final JdbcTemplate db; private final SchoolVault vault; private final SchoolAdapter adapter;
    private final ObjectMapper json; private final TransactionTemplate tx;
    private final Object[] locks = new Object[64];
    public SchoolController(JdbcTemplate db, SchoolVault vault, SchoolAdapter adapter, ObjectMapper json, PlatformTransactionManager manager) {
        this.db=db; this.vault=vault; this.adapter=adapter; this.json=json; this.tx=new TransactionTemplate(manager);
        Arrays.setAll(locks,i->new Object());
    }
    public record Credentials(@NotBlank @Size(max=80) String username,@NotBlank @Size(max=200) String password,boolean saveConsent) {}
    public record ImportInput(@Min(2000) @Max(2100) int year,@Pattern(regexp="[1-4]") @NotNull String semester) {}
    private long user(Authentication a) { return Long.parseLong(a.getName()); }
    private Object lock(long u) { return locks[(int)(u%locks.length)]; }
    @GetMapping("/prompt") public Map<String,Boolean> prompt(Authentication auth,jakarta.servlet.http.HttpServletRequest request) {
        boolean linked = Boolean.TRUE.equals(status(auth).get("linked"));
        var session=request.getSession();
        synchronized(session) {
            boolean show=!linked && session.getAttribute("school.prompt.shown")==null;
            session.setAttribute("school.prompt.shown",true);
            return Map.of("show",show);
        }
    }
    @GetMapping public Map<String,Object> status(Authentication auth) {
        long u=user(auth);
        var rows=db.queryForList("select linked, imported_at from school_links where user_id=?",u);
        Map<String,Object> result=new HashMap<>();
        result.put("saved",!rows.isEmpty());
        result.put("linked",!rows.isEmpty() && Boolean.TRUE.equals(rows.getFirst().get("linked")));
        result.put("courses",db.queryForList("select c.name,c.semester,s.schedule from school_courses s join courses c on c.id=s.course_id where s.user_id=? order by c.semester desc,c.name",u));
        return result;
    }
    @PutMapping public Map<String,Boolean> save(Authentication auth,@Valid @RequestBody Credentials input) throws Exception {
        if(!input.saveConsent()) throw new AuthException("학교 로그인 정보 저장에 동의해 주세요.",400);
        long u=user(auth);
        String plain=json.writeValueAsString(Map.of("username",input.username(),"password",input.password()));
        synchronized(lock(u)) {
            adapter.verify(plain);
            String encrypted=vault.encrypt(u,plain);
            tx.executeWithoutResult(status -> {
                if(db.update("update school_links set credentials=?,linked=true,preview=null where user_id=?",encrypted,u)==0)
                    db.update("insert into school_links(user_id,credentials,linked) values(?,?,true)",u,encrypted);
            });
        }
        return Map.of("saved",true);
    }
    @DeleteMapping public Map<String,Boolean> disconnect(Authentication auth) {
        long u=user(auth);
        synchronized(lock(u)) { db.update("delete from school_links where user_id=?",u); }
        return Map.of("saved",false);
    }
    @PostMapping("/preview") public Object preview(Authentication auth,@Valid @RequestBody ImportInput input) throws Exception {
        long u=user(auth);
        synchronized(lock(u)) {
            var stored=db.queryForList("select credentials from school_links where user_id=?",String.class,u);
            if(stored.isEmpty()) throw new AuthException("학교 로그인 정보를 먼저 저장해 주세요.",400);
            var result=adapter.fetch(vault.decrypt(u,stored.getFirst()),input.year(),input.semester());
            if(!result.path("courses").isArray() || result.path("courses").isEmpty()) throw new AuthException("확인된 수강 과목이 없습니다. 학기를 확인해 주세요.",422);
            if(result.path("year").asInt()!=input.year() || !result.path("semester").asText().equals(input.semester())) throw new AuthException("조회한 학기가 일치하지 않습니다.",422);
            db.update("update school_links set preview=? where user_id=?",json.writeValueAsString(result),u);
            return result;
        }
    }
    @PostMapping("/confirm") public Map<String,Integer> confirm(Authentication auth) throws Exception {
        long u=user(auth);
        synchronized(lock(u)) {
            var previews=db.queryForList("select preview from school_links where user_id=?",String.class,u);
            if(previews.isEmpty() || previews.getFirst()==null) throw new AuthException("시간표 미리보기를 먼저 가져와 주세요.",400);
            var data=json.readTree(previews.getFirst());
            return tx.execute(status -> {
                String semester=data.path("year").asText()+"년 "+Map.of("1","1학기","2","2학기","3","여름학기","4","겨울학기").get(data.path("semester").asText());
                int count=0;
                for(var row:data.path("courses")) {
                    String external=data.path("year").asText()+":"+data.path("semester").asText()+":"+row.path("code").asText()+":"+row.path("section").asText();
                    var mapped=db.queryForList("select course_id from school_courses where user_id=? and external_id=?",String.class,u,external);
                    if(mapped.isEmpty()) {
                        String id=UUID.randomUUID().toString();
                        db.update("insert into courses(id,user_id,semester,name) values(?,?,?,?)",id,u,semester,row.path("name").asText());
                        db.update("insert into school_courses(user_id,external_id,course_id,schedule) values(?,?,?,?)",u,external,id,row.path("schedule").asText());
                    } else db.update("update school_courses set schedule=? where user_id=? and external_id=?",row.path("schedule").asText(),u,external);
                    count++;
                }
                db.update("update school_links set linked=true,preview=null,imported_at=current_timestamp where user_id=?",u);
                return Map.of("count",count);
            });
        }
    }
}
