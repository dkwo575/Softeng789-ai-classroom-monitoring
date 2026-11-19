package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.auth.account-email.provider", havingValue = "smtp")
public class SmtpAccountLinkMailGateway implements AccountLinkMailGateway {
    private final JavaMailSender sender;
    private final String from;
    public SmtpAccountLinkMailGateway(JavaMailSender sender, @Value("${app.auth.account-email.from:}") String from) {
        this.sender = sender; this.from = from;
    }
    public boolean available() { return true; }
    public void send(String email, AccountLinkPurpose purpose, String link) {
        var message = new SimpleMailMessage();
        message.setFrom(from); message.setTo(email);
        message.setSubject(purpose == AccountLinkPurpose.PASSWORD_RESET ? "ClassLens — reset your password"
                : "ClassLens — verify your email");
        message.setText((purpose == AccountLinkPurpose.GUARDIAN_VERIFICATION
                ? "A student has named you as their parent or guardian. Open this link to review the signup request. This is not permission for face recognition.\n\n"
                : "") + "Use this single-use link within 30 minutes:\n\n" + link
                + "\n\nIf you did not request it, ignore this message. Your account has not been changed."
                + "\nNever forward this link or share it with anyone.");
        sender.send(message);
    }
}
