package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import io.github.huijingmen.softeng789.classroommonitoring.dto.*;
import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class StudentSignupProfiles {
    public static final String GUARDIAN_NOTICE = "guardian-signup-v1";
    private final StudentRepository students;
    private final StudentGuardianRepository guardians;
    private final EntityManager em;
    public StudentSignupProfiles(StudentRepository students, StudentGuardianRepository guardians, EntityManager em) {
        this.students=students; this.guardians=guardians; this.em=em;
    }
    public static boolean minor(LocalDate birth) {
        return birth != null && birth.plusYears(18).isAfter(LocalDate.now(ZoneId.of("Pacific/Auckland")));
    }
    public void validateRegistration(StudentProfileInput input, String attendanceMode, boolean faceConsent) {
        if (input == null) return; // Legacy registrations retain their existing approval contract.
        if (input.dateOfBirth() != null && !input.dateOfBirth().isBefore(LocalDate.now(ZoneId.of("Pacific/Auckland"))))
            throw new ResponseStatusException(BAD_REQUEST, "Enter a date of birth in the past.");
        if (minor(input.dateOfBirth())) {
            if (input.guardian() == null) throw new ResponseStatusException(BAD_REQUEST, "A parent or guardian is required for students under 18.");
            if ("FACE".equals(attendanceMode) || faceConsent)
                throw new ResponseStatusException(BAD_REQUEST, "Face registration remains an adult volunteer pilot. Choose manual attendance.");
        }
    }
    public void register(Student student, StudentProfileInput input, boolean emailVerified, boolean selfSignup) {
        student.setSignupChecksRequired(selfSignup);
        if (emailVerified) student.setEmailVerifiedAt(Instant.now());
        if (input != null) apply(student, input, true);
    }
    @Transactional(readOnly=true)
    public StudentProfileResponse read(UUID id) { return response(find(id)); }

    @Transactional
    public StudentProfileResponse update(UUID id, UpdateSelfProfileRequest request) {
        Student student=lock(id);
        if (!Objects.equals(request.version(), student.getVersion()))
            throw new ResponseStatusException(CONFLICT, "Your profile changed. Reload it before saving.");
        if (student.getDateOfBirth()!=null && !Objects.equals(student.getDateOfBirth(), request.profile().dateOfBirth()))
            throw new ResponseStatusException(BAD_REQUEST, "Contact an administrator to correct your date of birth.");
        apply(student, request.profile(), false);
        student.touchProfile();
        students.saveAndFlush(student);
        return response(student);
    }
    private void apply(Student student, StudentProfileInput input, boolean registration) {
        if (registration || !"APPROVED".equals(student.getApprovalStatus())) validateRegistration(input, "MANUAL", false);
        else if (input.dateOfBirth()!=null && !input.dateOfBirth().isBefore(LocalDate.now(ZoneId.of("Pacific/Auckland"))))
            throw new ResponseStatusException(BAD_REQUEST, "Enter a date of birth in the past.");
        var current=guardians.findById(student.getId()).orElse(null);
        var incoming=input.guardian();
        if (incoming!=null && (incoming.email().trim().equalsIgnoreCase(student.getUniversityEmail().trim())
                || incoming.email().trim().equalsIgnoreCase(clean(input.contactEmail()))))
            throw new ResponseStatusException(BAD_REQUEST, "Guardian email must differ from the student's login and contact emails.");
        if (!registration && student.isSignupChecksRequired() && current!=null && incoming==null)
            throw new ResponseStatusException(BAD_REQUEST, "Contact the school to remove a guardian from a signup requiring verification.");
        // Approved students cannot replace a trusted guardian through a self-service contact edit.
        if (!registration && "APPROVED".equals(student.getApprovalStatus()) && !same(current,incoming))
            throw new ResponseStatusException(BAD_REQUEST, "Contact an administrator to change your guardian details.");
        student.setDateOfBirth(input.dateOfBirth());
        student.setSchoolName(clean(input.schoolName())); student.setAddress(clean(input.address()));
        student.setPhone(clean(input.phone())); student.setContactEmail(clean(input.contactEmail()));
        if (!same(current,incoming)) {
            if (incoming==null && current!=null) guardians.delete(current);
            else {
                if (current==null) current=new StudentGuardian(student.getId());
                current.replace(clean(incoming.name()), clean(incoming.relationship()),
                        clean(incoming.email()).toLowerCase(Locale.ROOT), clean(incoming.phone()));
                guardians.save(current);
            }
        }
    }
    private boolean same(StudentGuardian current, StudentProfileInput.GuardianInput incoming) {
        if (current==null || incoming==null) return current==null && incoming==null;
        return current.getName().equals(clean(incoming.name()))
                && current.getRelationship().equals(clean(incoming.relationship()))
                && current.getEmail().equalsIgnoreCase(clean(incoming.email()))
                && current.getPhone().equals(clean(incoming.phone()));
    }
    public void requireApproval(Student student) {
        if (!student.isSignupChecksRequired()) return;
        var guardian=guardians.findById(student.getId()).orElse(null);
        if (guardian==null && !minor(student.getDateOfBirth())) return;
        if (guardian==null) throw new ResponseStatusException(BAD_REQUEST, "Guardian details are required before approval.");
        if (guardian.getEmail().equalsIgnoreCase(student.getUniversityEmail())
                || guardian.getEmail().equalsIgnoreCase(clean(student.getContactEmail())))
            throw new ResponseStatusException(BAD_REQUEST, "Guardian email must differ from the student's emails before approval.");
        if (guardian.getEmailVerifiedAt()==null || guardian.getSignupConsentedAt()==null
                || guardian.getRelationshipConfirmedAt()==null)
            throw new ResponseStatusException(BAD_REQUEST, "Guardian email, signup permission and independent relationship confirmation are required before approval.");
    }
    @Transactional
    public StudentProfileResponse confirmGuardian(UUID id, UUID admin, UUID revision, String method) {
        Student student=lock(id);
        var guardian=guardians.findById(id).orElseThrow(() -> new ResponseStatusException(BAD_REQUEST,"No guardian is recorded."));
        if (!guardian.getRevision().equals(revision)) throw new ResponseStatusException(CONFLICT,"Guardian details changed. Reload before confirming.");
        if (!Set.of("ENROLMENT_RECORD","IN_PERSON").contains(method))
            throw new ResponseStatusException(BAD_REQUEST,"Choose an independent relationship verification method.");
        if (guardian.getEmailVerifiedAt()==null || guardian.getSignupConsentedAt()==null)
            throw new ResponseStatusException(CONFLICT,"The guardian must first verify their email and give signup permission.");
        guardian.confirmRelationship(admin,method); student.touchProfile(); em.flush();
        return response(student);
    }
    Student lock(UUID id) {
        Student student=em.find(Student.class,id,LockModeType.PESSIMISTIC_WRITE);
        if (student==null) throw new ResponseStatusException(NOT_FOUND,"Student not found.");
        em.refresh(student,LockModeType.PESSIMISTIC_WRITE);
        guardians.findById(id).ifPresent(em::refresh);
        requireActive(student); return student;
    }
    private Student find(UUID id) {
        Student student=students.findById(id).orElseThrow(() -> new ResponseStatusException(NOT_FOUND,"Student not found."));
        guardians.findById(id).ifPresent(em::refresh);
        requireActive(student); return student;
    }
    private void requireActive(Student student) {
        if (!"ACTIVE".equals(student.getStatus()) || "REJECTED".equals(student.getApprovalStatus()))
            throw new ResponseStatusException(FORBIDDEN,"This account cannot change its registration.");
    }
    private StudentProfileResponse response(Student s) {
        var g=guardians.findById(s.getId()).orElse(null);
        return new StudentProfileResponse(s.getId(),s.getStudentNumber(),s.getFullName(),s.getUniversityEmail(),
            s.getDateOfBirth(),s.getSchoolName(),s.getAddress(),s.getPhone(),s.getContactEmail(),s.getVersion(),
            s.isSignupChecksRequired(),s.getEmailVerifiedAt(),g==null?null:new StudentProfileResponse.Guardian(
                g.getName(),g.getRelationship(),g.getEmail(),g.getPhone(),g.getEmailVerifiedAt(),
                g.getSignupConsentedAt(),g.getRelationshipConfirmedAt(),g.getRevision()));
    }
    private static String clean(String value) { return value==null?"":value.trim(); }
}