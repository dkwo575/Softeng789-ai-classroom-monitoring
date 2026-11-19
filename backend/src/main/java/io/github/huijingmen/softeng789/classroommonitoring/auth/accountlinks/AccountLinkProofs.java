package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.BAD_REQUEST;

@Service
public class AccountLinkProofs {
    private final AccountLinkRepository links;
    private final AccountLinkTargets targets;
    public AccountLinkProofs(AccountLinkRepository links, AccountLinkTargets targets) { this.links = links; this.targets = targets; }
    public record Details(String email, AccountLinkPurpose purpose, String role, String studentName) {
        @Override public String toString() { return "AccountLinkDetails[redacted]"; }
    }

    @Transactional(readOnly = true)
    public Details inspect(String token) {
        var row = validate(lookup(token, false));
        return new Details(row.getPurpose()==AccountLinkPurpose.GUARDIAN_VERIFICATION ? null : row.getEmail(),
                row.getPurpose(), row.getAccountRole(), targets.subjectName(row));
    }

    @Transactional(readOnly = true)
    public void checkRegistration(String token, AccountLinkPurpose purpose, String email, UUID accountId, String role) {
        checkBinding(validate(lookup(token, false)), purpose, email, accountId, role);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void consumeRegistration(String token, AccountLinkPurpose purpose, String email, UUID accountId, String role) {
        var row = validate(lookup(token, true));
        checkBinding(row, purpose, email, accountId, role);
        row.consume();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public AccountLink consumePasswordReset(String token) {
        var row = validate(lookup(token, true));
        if (row.getPurpose() != AccountLinkPurpose.PASSWORD_RESET || row.getAccountId() == null) throw invalid();
        row.consume();
        return row;
    }

    @Transactional(readOnly=true)
    public UUID contactSubject(String token) {
        var row=validate(lookup(token,false));
        requireContact(row);
        return row.getSubjectId();
    }
    @Transactional(propagation=Propagation.MANDATORY)
    public AccountLink consumeContact(String token) {
        var row=validate(lookup(token,true));
        requireContact(row); row.consume(); return row;
    }
    private void requireContact(AccountLink row) {
        if (row.getSubjectId()==null || (row.getPurpose()!=AccountLinkPurpose.STUDENT_EMAIL
                && row.getPurpose()!=AccountLinkPurpose.GUARDIAN_VERIFICATION)) throw invalid();
    }
    private AccountLink lookup(String token, boolean lock) {
        if (!AccountLinkSecrets.valid(token)) throw invalid();
        String digest = AccountLinkSecrets.digest(token);
        return (lock ? links.lockProof(digest) : links.findByCredentialDigest(digest)).orElseThrow(AccountLinkProofs::invalid);
    }

    private AccountLink validate(AccountLink row) {
        if (!row.usable(Instant.now()) || !targets.matches(row)) throw invalid();
        return row;
    }

    private void checkBinding(AccountLink row, AccountLinkPurpose purpose, String email, UUID accountId, String role) {
        if (row.getPurpose() != purpose || !row.getEmail().equalsIgnoreCase(email.trim())
                || !Objects.equals(row.getAccountId(), accountId) || !row.getAccountRole().equals(role)) throw invalid();
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(BAD_REQUEST,
                "This link is invalid, expired or already used. Request a new link and try again.");
    }
}
