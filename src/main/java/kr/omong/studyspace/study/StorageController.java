package kr.omong.studyspace.study;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/account")
public class StorageController {
    private final StorageQuotaService quota;
    private final AiUsageLimiter aiUsageLimiter;
    public StorageController(StorageQuotaService quota,AiUsageLimiter aiUsageLimiter){this.quota=quota;this.aiUsageLimiter=aiUsageLimiter;}
    @GetMapping("/storage") public StorageQuotaService.Usage storage(Authentication auth){return quota.usage(Long.parseLong(auth.getName()));}
    @GetMapping("/ai-usage") public AiUsageLimiter.DailyUsage aiUsage(Authentication auth){return aiUsageLimiter.usage(Long.parseLong(auth.getName()));}
}
