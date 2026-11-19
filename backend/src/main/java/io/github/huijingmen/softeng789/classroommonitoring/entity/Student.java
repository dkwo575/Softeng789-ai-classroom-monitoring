package io.github.huijingmen.softeng789.classroommonitoring.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "students")
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String studentNumber;

    @Column(nullable = false, unique = true)
    private String universityEmail;

    @Column(nullable = false)
    private String firstName;

    @Column(nullable = false)
    private String lastName;

    @Column(nullable = false)
    private String course;

    @Column(nullable = false)
    private String seat;

    @Column(nullable = false)
    private String programme;

    @Column(nullable = false)
    private boolean consentGiven;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private FaceEnrollmentStatus faceEnrollmentStatus = FaceEnrollmentStatus.NOT_ENROLLED;

    // A student attribute, independent of room or class — the same room hosts different levels at
    // different times, just like it already hosts different courses (see Campus/Room instead).
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StudentLevel level = StudentLevel.LEVEL_1;

    // "PENDING" or "APPROVED" — plain string to match Teacher.role/CourseOffering.status's style.
    // Only a brand-new self-registration starts PENDING; staff-created and pre-existing accounts
    // default to APPROVED since someone already vouched for them.
    @Column(name = "approval_status", nullable = false, length = 20)
    private String approvalStatus = "APPROVED";

    // "ACTIVE" or "WITHDRAWN" — same soft-terminal idea as Teacher.status's ACTIVE/DEACTIVATED and
    // CourseEnrollment's WITHDRAWN: a withdrawn student keeps every historical record (attendance,
    // past enrolments, face enrolment) untouched, they just can't log in or be enrolled in
    // anything new until reactivated.
    @Column(nullable = false, length = 20)
    private String status = "ACTIVE";

    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    // Lets two concurrent registration requests racing to claim the same passwordless record be
    // told apart safely — see AuthService's registerStudent/registerTeacher claim logic.
    @Version
    private Long version;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @Column(nullable=false) private long profileRevision;
    public void touchProfile() { profileRevision++; }
    public Long getVersion() { return version; }
    private java.time.LocalDate dateOfBirth;
    @Column(length = 160) private String schoolName;
    @Column(length = 500) private String address;
    @Column(length = 40) private String phone;
    @Column(length = 255) private String contactEmail;
    @Column(nullable = false) private boolean signupChecksRequired;
    private Instant emailVerifiedAt;

    public java.time.LocalDate getDateOfBirth() { return dateOfBirth; }
    public void setDateOfBirth(java.time.LocalDate value) { dateOfBirth = value; }
    public String getSchoolName() { return schoolName; }
    public void setSchoolName(String value) { schoolName = value; }
    public String getAddress() { return address; }
    public void setAddress(String value) { address = value; }
    public String getPhone() { return phone; }
    public void setPhone(String value) { phone = value; }
    public String getContactEmail() { return contactEmail; }
    public void setContactEmail(String value) { contactEmail = value; }
    public boolean isSignupChecksRequired() { return signupChecksRequired; }
    public void setSignupChecksRequired(boolean value) { signupChecksRequired = value; }
    public Instant getEmailVerifiedAt() { return emailVerifiedAt; }
    public void setEmailVerifiedAt(Instant value) { emailVerifiedAt = value; }

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public String getStudentNumber() {
        return studentNumber;
    }

    public void setStudentNumber(String studentNumber) {
        this.studentNumber = studentNumber;
    }

    public String getUniversityEmail() {
        return universityEmail;
    }

    public void setUniversityEmail(String universityEmail) {
        if (this.universityEmail != null && !this.universityEmail.equalsIgnoreCase(universityEmail)) emailVerifiedAt = null;
        this.universityEmail = universityEmail;
    }

    public String getFirstName() {
        return firstName;
    }

    public void setFirstName(String firstName) {
        this.firstName = firstName;
    }

    public String getLastName() {
        return lastName;
    }

    public void setLastName(String lastName) {
        this.lastName = lastName;
    }

    public String getFullName() {
        return firstName + " " + lastName;
    }

    public String getCourse() {
        return course;
    }

    public void setCourse(String course) {
        this.course = course;
    }

    public String getSeat() {
        return seat;
    }

    public void setSeat(String seat) {
        this.seat = seat;
    }

    public String getProgramme() {
        return programme;
    }

    public void setProgramme(String programme) {
        this.programme = programme;
    }

    public boolean isConsentGiven() {
        return consentGiven;
    }

    public void setConsentGiven(boolean consentGiven) {
        this.consentGiven = consentGiven;
    }

    public FaceEnrollmentStatus getFaceEnrollmentStatus() {
        return faceEnrollmentStatus;
    }

    public void setFaceEnrollmentStatus(FaceEnrollmentStatus faceEnrollmentStatus) {
        this.faceEnrollmentStatus = faceEnrollmentStatus;
    }

    public StudentLevel getLevel() {
        return level;
    }

    public void setLevel(StudentLevel level) {
        this.level = level;
    }

    public String getApprovalStatus() {
        return approvalStatus;
    }

    public void setApprovalStatus(String approvalStatus) {
        this.approvalStatus = approvalStatus;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
