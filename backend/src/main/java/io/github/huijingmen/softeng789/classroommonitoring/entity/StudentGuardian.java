package io.github.huijingmen.softeng789.classroommonitoring.entity;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
/** A current guardian relationship per student; a mailbox may support siblings. */
@Entity @Table(name="student_guardians")
public class StudentGuardian {
    @Id @Column(name="student_id") private UUID studentId;
    @Column(nullable=false, length=160) private String name;
    @Column(nullable=false, length=80) private String relationship;
    @Column(nullable=false, length=255) private String email;
    @Column(nullable=false, length=40) private String phone;
    @Column(nullable=false) private UUID revision;
    private Instant emailVerifiedAt;
    private Instant signupConsentedAt;
    @Column(length=80) private String noticeVersion;
    private Instant relationshipConfirmedAt;
    private UUID relationshipConfirmedBy;
    @Column(length=32) private String verificationMethod;
    @Version private Long version;
    protected StudentGuardian() {}
    public StudentGuardian(UUID studentId) { this.studentId = studentId; }
    public void replace(String name, String relationship, String email, String phone) {
        this.name=name; this.relationship=relationship; this.email=email; this.phone=phone;
        revision=UUID.randomUUID();
        emailVerifiedAt=null; signupConsentedAt=null; noticeVersion=null;
        relationshipConfirmedAt=null; relationshipConfirmedBy=null; verificationMethod=null;
    }
    public void verify(String notice) {
        emailVerifiedAt=Instant.now(); signupConsentedAt=emailVerifiedAt; noticeVersion=notice;
    }
    public void confirmRelationship(UUID admin, String method) {
        verificationMethod=method; relationshipConfirmedBy=admin; relationshipConfirmedAt=Instant.now();
    }
    public UUID getStudentId() { return studentId; }
    public String getName() { return name; }
    public String getRelationship() { return relationship; }
    public String getEmail() { return email; }
    public String getPhone() { return phone; }
    public UUID getRevision() { return revision; }
    public Instant getEmailVerifiedAt() { return emailVerifiedAt; }
    public Instant getSignupConsentedAt() { return signupConsentedAt; }
    public Instant getRelationshipConfirmedAt() { return relationshipConfirmedAt; }
    @Override public String toString() { return "StudentGuardian[redacted]"; }
}