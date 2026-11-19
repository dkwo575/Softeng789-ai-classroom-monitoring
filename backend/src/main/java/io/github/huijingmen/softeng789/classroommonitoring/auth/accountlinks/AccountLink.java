package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/** Durable delivery claim and digest-only, single-use proof. No plaintext token or mail body. */
@Entity
@Table(name = "account_links")
public class AccountLink {
    @Id
    private UUID id;
    @Column(nullable = false, length = 255)
    private String email;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AccountLinkPurpose purpose;
    @Column(nullable = false, length = 20)
    private String state;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;
    @Column(name = "credential_digest", unique = true, length = 64)
    private String credentialDigest;
    @Column(name = "account_id")
    private UUID accountId;
    @Column(name = "account_role", length = 20)
    private String accountRole;
    @Column(name = "password_fingerprint", length = 64)
    private String passwordFingerprint;
    private UUID subjectId;
    @Column(length = 64) private String subjectRevision;
    public void bindSubject(UUID id, String revision) { subjectId = id; subjectRevision = revision; }
    public UUID getSubjectId() { return subjectId; }
    public String getSubjectRevision() { return subjectRevision; }
    @Override public String toString() { return "AccountLink[redacted]"; }
    @Version
    @Column(nullable = false)
    private Long version;

    protected AccountLink() { }

    public AccountLink(String email, AccountLinkPurpose purpose, Instant now) {
        id = UUID.randomUUID();
        this.email = email;
        this.purpose = purpose;
        state = "REQUESTED";
        createdAt = now;
        expiresAt = now.plusSeconds(1800);
    }

    public void dispatch(String digest, UUID target, String role, String fingerprint, Instant now) {
        credentialDigest = digest;
        accountId = target;
        accountRole = role;
        passwordFingerprint = fingerprint;
        state = "DISPATCHED";
        expiresAt = now.plusSeconds(1800);
    }

    public boolean usable(Instant now) { return "DISPATCHED".equals(state) && now.isBefore(expiresAt); }
    public void discard() { state = "DISCARDED"; }
    public void consume() { state = "USED"; }
    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public AccountLinkPurpose getPurpose() { return purpose; }
    public UUID getAccountId() { return accountId; }
    public String getAccountRole() { return accountRole; }
    public String getPasswordFingerprint() { return passwordFingerprint; }
    public Instant getExpiresAt() { return expiresAt; }
    public String getState() { return state; }
    public String getCredentialDigest() { return credentialDigest; }
}
