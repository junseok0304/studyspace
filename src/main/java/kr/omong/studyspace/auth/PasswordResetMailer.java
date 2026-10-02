package kr.omong.studyspace.auth;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMultipart;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

@Component
public class PasswordResetMailer {
    private final ObjectProvider<JavaMailSender> senders;
    private final String from;
    private final String host;

    public PasswordResetMailer(ObjectProvider<JavaMailSender> senders,
                               @Value("${studyspace.auth.mail-from:no-reply@studyspace.omong.kr}") String from,
                               @Value("${studyspace.auth.mail-host:}") String host) {
        this.senders = senders;
        this.from = from;
        this.host = host;
    }

    public boolean send(String email, String resetUrl) {
        if (host.isBlank()) return false;
        JavaMailSender sender = senders.getIfAvailable();
        if (sender == null) return false;
        try {
            var message = sender.createMimeMessage();
            var helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(from);
            helper.setTo(email);
            helper.setSubject("[StudySpace] 비밀번호 재설정");
            var alternatives = new MimeMultipart("alternative");
            var plainPart = new MimeBodyPart();
            plainPart.setText(buildTextBody(resetUrl), "UTF-8");
            alternatives.addBodyPart(plainPart);
            var htmlPart = new MimeBodyPart();
            htmlPart.setContent(buildHtmlBody(resetUrl), "text/html; charset=UTF-8");
            htmlPart.setHeader("Content-Type", "text/html; charset=UTF-8");
            alternatives.addBodyPart(htmlPart);
            message.setContent(alternatives);
            sender.send(message);
            return true;
        } catch (MessagingException e) {
            throw new IllegalStateException("비밀번호 재설정 메일을 만들지 못했습니다.", e);
        }
    }

    private String buildTextBody(String resetUrl) {
        return "StudySpace 비밀번호 재설정 안내입니다.\n\n"
                + "아래 링크를 30분 이내에 열어 새 비밀번호를 설정해 주세요.\n"
                + resetUrl + "\n\n"
                + "요청하지 않았다면 이 메일을 무시해 주세요.";
    }

    private String buildHtmlBody(String resetUrl) {
        String safeUrl = escapeHtml(resetUrl);
        return """
                <!doctype html>
                <html lang="ko">
                  <body style="margin:0;padding:0;background:#eff6ff;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
                    <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
                      <div style="overflow:hidden;border:1px solid #dbeafe;border-radius:16px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.08);">
                        <div style="padding:24px 28px;background:#2563eb;color:#fff;">
                          <div style="font-size:13px;letter-spacing:.08em;font-weight:700;text-transform:uppercase;">StudySpace</div>
                          <div style="margin-top:8px;font-size:24px;font-weight:700;">비밀번호 재설정</div>
                          <div style="margin-top:8px;font-size:14px;">계정 보안을 위해 아래 절차를 진행해 주세요.</div>
                        </div>
                        <div style="padding:28px;">
                          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 설정해 주세요.</p>
                          <div style="margin:28px 0;text-align:center;">
                            <a href="%s" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:15px;">비밀번호 재설정하기</a>
                          </div>
                          <p style="margin:0 0 12px;font-size:14px;color:#475569;line-height:1.7;">이 링크는 30분 동안 유효합니다. 버튼이 작동하지 않으면 아래 주소를 복사해 브라우저에서 열어 주세요.</p>
                          <p style="overflow-wrap:anywhere;font-size:13px;line-height:1.6;"><a href="%s" style="color:#1d4ed8;">%s</a></p>
                          <p style="margin:24px 0 0;font-size:12px;color:#64748b;line-height:1.6;text-align:center;">요청하지 않았다면 이 메일을 무시해 주세요.</p>
                        </div>
                      </div>
                    </div>
                  </body>
                </html>
                """.formatted(safeUrl, safeUrl, safeUrl);
    }

    private String escapeHtml(String value) {
        return value.replace("&", "&amp;").replace("\"", "&quot;")
                .replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;");
    }
}
