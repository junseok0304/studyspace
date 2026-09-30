package kr.omong.studyspace.study;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/api/account")
public class StorageController {
    private final StorageQuotaService quota;
    public StorageController(StorageQuotaService quota){this.quota=quota;}
    @GetMapping("/storage") public StorageQuotaService.Usage storage(Authentication auth){return quota.usage(Long.parseLong(auth.getName()));}
}
