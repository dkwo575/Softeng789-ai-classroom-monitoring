package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import io.github.huijingmen.softeng789.classroommonitoring.repository.StudentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.TeacherRepository;
import io.github.huijingmen.softeng789.classroommonitoring.service.ClassroomSessionService;
import io.github.huijingmen.softeng789.classroommonitoring.entity.Student;
import io.github.huijingmen.softeng789.classroommonitoring.entity.Teacher;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Eligibility is resolved again on dispatch and redemption, not trusted from a form or old link. */
@Component
public class AccountLinkTargets {
    private final StudentRepository students;
    private final TeacherRepository staff;
    private final io.github.huijingmen.softeng789.classroommonitoring.repository.StudentGuardianRepository guardians;
    public AccountLinkTargets(StudentRepository students, TeacherRepository staff,
            io.github.huijingmen.softeng789.classroommonitoring.repository.StudentGuardianRepository guardians) {
        this.students=students; this.staff=staff; this.guardians=guardians;
    }
    record Target(UUID id, String role, String passwordHash) {
        @Override public String toString() { return "AccountLinkTarget[redacted]"; }
    }

    Target resolve(String email, AccountLinkPurpose purpose) {
        var student = students.findByUniversityEmailIgnoreCase(email);
        var teacher = staff.findByEmailIgnoreCase(email);
        // Cross-role email collisions must be corrected by staff, never arbitrarily selected.
        if (student.isPresent() && teacher.isPresent()) return null;
        return switch (purpose) {
            case STUDENT_EMAIL, GUARDIAN_VERIFICATION -> null;
            case STUDENT_REGISTRATION -> teacher.isPresent() ? null : studentRegistration(student.orElse(null));
            case STAFF_ACTIVATION -> staffTarget(teacher.orElse(null), true);
            case PASSWORD_RESET -> teacher.isPresent() ? staffTarget(teacher.get(), false)
                    : studentReset(student.orElse(null));
        };
    }

    private Target studentRegistration(Student student) {
        if (student == null) return new Target(null, "STUDENT", null);
        return "ACTIVE".equals(student.getStatus()) && student.getPasswordHash() == null
                ? new Target(student.getId(), "STUDENT", null) : null;
    }

    private Target staffTarget(Teacher teacher, boolean activation) {
        if (teacher == null || !"ACTIVE".equals(teacher.getStatus())
                || teacher.getEmail().equalsIgnoreCase(ClassroomSessionService.DEFAULT_TEACHER_EMAIL)
                || !("TEACHER".equals(teacher.getRole()) || "ADMIN".equals(teacher.getRole()))) return null;
        if (activation != (teacher.getPasswordHash() == null)) return null;
        return new Target(teacher.getId(), teacher.getRole(), teacher.getPasswordHash());
    }

    private Target studentReset(Student student) {
        return student != null && "ACTIVE".equals(student.getStatus()) && student.getPasswordHash() != null
                ? new Target(student.getId(), "STUDENT", student.getPasswordHash()) : null;
    }

    Target resolve(AccountLink row) {
        if (row.getPurpose()!=AccountLinkPurpose.STUDENT_EMAIL && row.getPurpose()!=AccountLinkPurpose.GUARDIAN_VERIFICATION)
            return resolve(row.getEmail(),row.getPurpose());
        if (row.getSubjectId()==null) return null;
        var student=students.findById(row.getSubjectId()).orElse(null);
        if (student==null || !"ACTIVE".equals(student.getStatus()) || "REJECTED".equals(student.getApprovalStatus())) return null;
        if (row.getPurpose()==AccountLinkPurpose.STUDENT_EMAIL) {
            if (!student.getUniversityEmail().equalsIgnoreCase(row.getEmail())
                    || !AccountLinkSecrets.digest(student.getUniversityEmail().toLowerCase(java.util.Locale.ROOT)).equals(row.getSubjectRevision())
                    || student.getEmailVerifiedAt()!=null) return null;
        } else {
            var guardian=guardians.findById(student.getId()).orElse(null);
            if (guardian==null || guardian.getEmail().equalsIgnoreCase(student.getUniversityEmail())
                    || !guardian.getEmail().equalsIgnoreCase(row.getEmail())
                    || !guardian.getRevision().toString().equals(row.getSubjectRevision())
                    || guardian.getEmailVerifiedAt()!=null) return null;
        }
        return new Target(student.getId(),"STUDENT",student.getPasswordHash());
    }
    String subjectName(AccountLink row) {
        return row.getPurpose()==AccountLinkPurpose.GUARDIAN_VERIFICATION && row.getSubjectId()!=null
                ? students.findById(row.getSubjectId()).map(Student::getFullName).orElse(null) : null;
    }
    boolean matches(AccountLink row) {
        var current = resolve(row);
        return current != null && java.util.Objects.equals(current.id(), row.getAccountId())
                && current.role().equals(row.getAccountRole())
                && AccountLinkSecrets.fingerprint(current.passwordHash()).equals(row.getPasswordFingerprint());
    }
}
