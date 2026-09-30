package kr.omong.studyspace.auth;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
public class PasswordResetMailer {
    private final ObjectProvider<JavaMailSender> senders;
    private final String from;
    private final String host;

    public PasswordResetMailer(ObjectProvider<JavaMailSender> senders,
                               @Value("${studyspace.auth.mail-from:no-reply@studyspace.omong.kr}") String from,
                               @Value("${spring.mail.host:}") String host) {
        this.senders = senders;
        this.from = from;
        this.host = host;
    }

    public boolean send(String email, String resetUrl) {
        if (host.isBlank()) return false;
        JavaMailSender sender = senders.getIfAvailable();
        if (sender == null) return false;
        var message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(email);
        message.setSubject("StudySpace 비밀번호 재설정");
        message.setText("비밀번호를 재설정하려면 아래 링크를 30분 이내에 열어 주세요.\n\n"
                + resetUrl + "\n\n요청하지 않았다면 이 메일을 무시해 주세요.");
        sender.send(message);
        return true;
    }
}
