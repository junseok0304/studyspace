package kr.omong.studyspace.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import kr.omong.studyspace.study.AccountFileCleanupService;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.session.SessionRegistry;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    private final JdbcTemplate db; private final UserAccountRepository users; private final PasswordEncoder passwords;
    private final TransactionTemplate transaction; private final AccountFileCleanupService cleanup;
    private final SessionRegistry sessions;
    public AccountController(JdbcTemplate db,UserAccountRepository users,PasswordEncoder passwords,TransactionTemplate transaction,AccountFileCleanupService cleanup,SessionRegistry sessions) {
        this.db=db;this.users=users;this.passwords=passwords;this.transaction=transaction;this.cleanup=cleanup;this.sessions=sessions;
    }
    public record DeleteAccount(@Size(max=72) String password,@NotBlank String confirmation) {}

    @GetMapping("/deletion") public Map<String,Boolean> deletionRequirements(Authentication auth) {
        return Map.of("requiresPassword",!users.hasSocialIdentity(Long.parseLong(auth.getName())));
    }

    @DeleteMapping
    public Map<String,Boolean> delete(Authentication auth,@Valid @RequestBody DeleteAccount input,HttpServletRequest request,HttpServletResponse response) {
        long userId=Long.parseLong(auth.getName());
        if(!"회원탈퇴".equals(input.confirmation())) throw new AuthException("확인란에 회원탈퇴를 정확히 입력해 주세요.",400);
        UserAccount user=users.findById(userId).orElseThrow(()->new AuthException("사용자를 찾을 수 없습니다.",401));
        boolean requiresPassword=!users.hasSocialIdentity(userId);
        if(requiresPassword && (input.password()==null || !passwords.matches(input.password(),user.passwordHash())))
            throw new AuthException("현재 비밀번호가 올바르지 않습니다.",400);
        transaction.executeWithoutResult(status->{
            db.queryForList("select storage_key from attachments where user_id=?",String.class,userId)
                    .forEach(key->db.update("insert into account_file_cleanup(kind,user_id,item_key) values('ATTACHMENT',?,?)",userId,key));
            db.queryForList("select id from recordings where user_id=?",String.class,userId)
                    .forEach(id->db.update("insert into account_file_cleanup(kind,user_id,item_key) values('RECORDING',?,?)",userId,id));
            if(db.update("delete from users where id=?",userId)!=1) throw new AuthException("사용자를 찾을 수 없습니다.",401);
        });
        cleanup.cleanupPending();
        sessions.getAllSessions(Long.toString(userId),false).forEach(info->info.expireNow());
        SecurityContextHolder.clearContext(); var session=request.getSession(false); if(session!=null) session.invalidate();
        expire(response,"JSESSIONID",true); expire(response,"XSRF-TOKEN",false);
        return Map.of("deleted",true);
    }
    private void expire(HttpServletResponse response,String name,boolean httpOnly) {
        response.addHeader("Set-Cookie",ResponseCookie.from(name,"").path("/").maxAge(0).httpOnly(httpOnly).sameSite("Lax").build().toString());
    }
}
