package kr.omong.studyspace.study;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration
public class GenerationConfig {
    @Bean("generationExecutor")
    TaskExecutor generationExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        // Each user may submit up to three simultaneous generations. Leave room
        // for several users to work concurrently without serializing their jobs.
        executor.setCorePoolSize(12);
        executor.setMaxPoolSize(12);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("studyspace-generation-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        executor.initialize();
        return executor;
    }
}
