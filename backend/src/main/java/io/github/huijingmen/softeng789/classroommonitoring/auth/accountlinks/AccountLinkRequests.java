package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import io.github.huijingmen.softeng789.classroommonitoring.auth.LoginAttemptStore;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;

@Service
public class AccountLinkRequests {
    private final AccountLinkRepository links;
    private final AccountLinkMailGateway mail;
    private final LoginAttemptStore attempts;
    public AccountLinkRequests(AccountLinkRepository links, AccountLinkMailGateway mail, LoginAttemptStore attempts) {
        this.links = links; this.mail = mail; this.attempts = attempts;
    }

    public void request(String email, AccountLinkPurpose purpose) {
        if (purpose==AccountLinkPurpose.STUDENT_EMAIL || purpose==AccountLinkPurpose.GUARDIAN_VERIFICATION)
            throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "Request verification from your signed-in profile.");
        enqueue(email,purpose,null,null);
    }
    public void requestSubject(String email, AccountLinkPurpose purpose, java.util.UUID id, String revision) {
        if (purpose!=AccountLinkPurpose.STUDENT_EMAIL && purpose!=AccountLinkPurpose.GUARDIAN_VERIFICATION)
            throw new IllegalArgumentException("Unsupported contact purpose");
        enqueue(email,purpose,id,revision);
    }
    private void enqueue(String email, AccountLinkPurpose purpose, java.util.UUID id, String revision) {
        if (!mail.available()) throw new ResponseStatusException(SERVICE_UNAVAILABLE,
                "Account email is not configured yet. Contact an administrator; no email was sent.");
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        // Separate namespace: requesting recovery must not lock somebody out of normal sign-in.
        attempts.reserve(AccountLinkSecrets.digest("account-mail:" + normalized), Instant.now(),
                3, Duration.ofHours(1), Duration.ofHours(1));
        // Account lookup/delivery occur later: existence and SMTP timing cannot leak here.
        // Repository save commits independently, after admission; no outer transaction holds a
        // pool connection while REQUIRES_NEW waits for a second one under concurrent requests.
        var row=new AccountLink(normalized,purpose,Instant.now());
        row.bindSubject(id,revision);
        links.save(row);
    }
}
