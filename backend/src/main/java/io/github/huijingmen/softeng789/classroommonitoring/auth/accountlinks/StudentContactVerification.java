package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;
@Service
public class StudentContactVerification {
    private final StudentRepository students;
    private final StudentGuardianRepository guardians;
    private final StudentSignupProfiles profiles;
    private final AccountLinkRequests requests;
    private final AccountLinkProofs proofs;
    public StudentContactVerification(StudentRepository students, StudentGuardianRepository guardians,
            StudentSignupProfiles profiles, AccountLinkRequests requests, AccountLinkProofs proofs) {
        this.students=students; this.guardians=guardians; this.profiles=profiles; this.requests=requests; this.proofs=proofs;
    }
    // Admission/queue commit has no outer transaction; SMTP runs in the existing worker.
    public void request(UUID id, AccountLinkPurpose purpose) {
        var student=students.findById(id).orElseThrow(() -> new ResponseStatusException(NOT_FOUND,"Student not found."));
        if (!"ACTIVE".equals(student.getStatus()) || "REJECTED".equals(student.getApprovalStatus()))
            throw new ResponseStatusException(FORBIDDEN,"This registration is unavailable.");
        if (purpose==AccountLinkPurpose.STUDENT_EMAIL) {
            if (student.getEmailVerifiedAt()!=null) throw new ResponseStatusException(CONFLICT,"This email is already verified.");
            requests.requestSubject(student.getUniversityEmail(),purpose,id,
                    AccountLinkSecrets.digest(student.getUniversityEmail().toLowerCase(Locale.ROOT)));
        } else if (purpose==AccountLinkPurpose.GUARDIAN_VERIFICATION) {
            var guardian=guardians.findById(id).orElseThrow(() -> new ResponseStatusException(BAD_REQUEST,"Add guardian details first."));
            if (guardian.getEmailVerifiedAt()!=null) throw new ResponseStatusException(CONFLICT,"This guardian email is already verified.");
            requests.requestSubject(guardian.getEmail(),purpose,id,guardian.getRevision().toString());
        } else throw new ResponseStatusException(BAD_REQUEST,"Unsupported verification request.");
    }
    @Transactional
    public void confirm(String token, boolean signupPermission, String noticeVersion) {
        UUID id=proofs.contactSubject(token);
        var student=profiles.lock(id);
        var row=proofs.consumeContact(token);
        if (row.getPurpose()==AccountLinkPurpose.GUARDIAN_VERIFICATION) {
            if (!signupPermission || !StudentSignupProfiles.GUARDIAN_NOTICE.equals(noticeVersion))
                throw new ResponseStatusException(BAD_REQUEST,"Read the current guardian notice and confirm signup permission.");
            guardians.findById(id).orElseThrow().verify(noticeVersion);
        } else student.setEmailVerifiedAt(Instant.now());
        student.touchProfile();
        // No changes to approval, biometric, local-analysis, observation or video consent.
    }
}