package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class StorageQuotaService {
    private final JdbcTemplate db; private final long limit;
    public StorageQuotaService(JdbcTemplate db,@Value("${STUDYSPACE_STORAGE_LIMIT_BYTES:3221225472}") long limit){this.db=db;this.limit=Math.max(1,limit);}
    public record Usage(long usedBytes,long limitBytes,long remainingBytes,double usedPercent){}
    public Usage usage(long user){
        Long attachments=db.queryForObject("select coalesce(sum(size_bytes),0) from attachments where user_id=?",Long.class,user);
        Long recordings=db.queryForObject("select coalesce(sum(size_bytes),0) from recordings where user_id=?",Long.class,user);
        long used=Math.max(0,(attachments==null?0:attachments)+(recordings==null?0:recordings));
        return new Usage(used,limit,Math.max(0,limit-used),Math.min(100,Math.round(used*1000.0/limit)/10.0));
    }
    public void requireAvailable(long user,long additional){
        if(additional<0)throw new AuthException("저장할 파일 크기가 올바르지 않습니다.",400);
        if(additional>usage(user).remainingBytes())throw new AuthException("저장공간이 부족합니다. 필요 없는 첨부자료나 녹음을 삭제해 주세요.",413);
    }
}
