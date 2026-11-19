package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;
import io.github.huijingmen.softeng789.classroommonitoring.dto.*;
import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import jakarta.persistence.EntityManager;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties={
    "spring.datasource.url=jdbc:h2:mem:signup-profile-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa",
    "spring.datasource.password=","spring.jpa.hibernate.ddl-auto=create-drop"})
@ActiveProfiles("postgres") @Import(AccountLinkTestInbox.class) @Transactional
class StudentSignupProfilesTest {
    @Autowired StudentRepository students;
    @Autowired StudentGuardianRepository guardians;
    @Autowired StudentSignupProfiles profiles;
    @Autowired StudentContactVerification contacts;
    @Autowired AccountLinkProofs proofs;
    @Autowired AccountLinkRepository links;
    @Autowired AccountLinkWorker worker;
    @Autowired AccountLinkTestInbox.Inbox inbox;
    @Autowired EntityManager em;
    @Autowired io.github.huijingmen.softeng789.classroommonitoring.service.StudentService studentService;
    @Autowired io.github.huijingmen.softeng789.classroommonitoring.service.AuthService authService;
    @Autowired io.github.huijingmen.softeng789.classroommonitoring.repository.TeacherRepository teachers;

    Student student() {
        var s=new Student();
        s.setStudentNumber("TEST-"+UUID.randomUUID());
        s.setUniversityEmail(UUID.randomUUID()+"@example.test");
        s.setFirstName("Sample"); s.setLastName("Student"); s.setCourse("TEST");
        s.setSeat("Unassigned"); s.setProgramme(""); s.setApprovalStatus("PENDING");
        s.setPasswordHash("test-hash"); return students.saveAndFlush(s);
    }
    StudentProfileInput input(boolean minor, String email) {
        return new StudentProfileInput(LocalDate.now(ZoneId.of("Pacific/Auckland")).minusYears(minor?12:25),
                "Sample School","Sample address","020000000","",
                email==null?null:new StudentProfileInput.GuardianInput("Sample Guardian","Parent",email,"021000000"));
    }
    String deliver(Student s, AccountLinkPurpose purpose, String email) {
        contacts.request(s.getId(),purpose); worker.deliverNext(); return inbox.take(email);
    }
    @Test void profilePreservesExistingStudentNumbers() {
        var one=student(); var two=student();
        assertThat(one.getStudentNumber()).isNotEqualTo(two.getStudentNumber());
        assertThat(students.findById(one.getId()).orElseThrow().getStudentNumber()).isEqualTo(one.getStudentNumber());
    }
    @Test void guardianMailboxIsNotRelationshipVerificationOrBiometricConsent() {
        var s=student(); String email=UUID.randomUUID()+"@guardian.test";
        profiles.register(s,input(true,email),false,true); em.flush();
        String token=deliver(s,AccountLinkPurpose.GUARDIAN_VERIFICATION,email);
        assertThat(proofs.inspect(token).studentName()).isEqualTo("Sample Student");
        assertThat(guardians.findById(s.getId()).orElseThrow().getEmailVerifiedAt()).isNull();
        contacts.confirm(token,true,StudentSignupProfiles.GUARDIAN_NOTICE); em.flush();
        var guardian=guardians.findById(s.getId()).orElseThrow();
        assertThat(guardian.getEmailVerifiedAt()).isNotNull();
        assertThat(guardian.getRelationshipConfirmedAt()).isNull();
        assertThat(s.isConsentGiven()).isFalse();
        assertThat(s.getApprovalStatus()).isEqualTo("PENDING");
        assertThatThrownBy(() -> profiles.requireApproval(s)).hasMessageContaining("independent relationship");
    }
    @Test void siblingsSharingMailboxHaveIndependentLinksAndConfirmation() {
        var one=student(); var two=student(); String email=UUID.randomUUID()+"@guardian.test";
        profiles.register(one,input(true,email),true,true); profiles.register(two,input(true,email),true,true); em.flush();
        String token=deliver(one,AccountLinkPurpose.GUARDIAN_VERIFICATION,email);
        contacts.confirm(token,true,StudentSignupProfiles.GUARDIAN_NOTICE); em.flush();
        assertThat(guardians.findById(one.getId()).orElseThrow().getEmailVerifiedAt()).isNotNull();
        assertThat(guardians.findById(two.getId()).orElseThrow().getEmailVerifiedAt()).isNull();
    }
    @Test void changedGuardianInvalidatesOldProofWithoutTransferringConsent() {
        var s=student(); String old=UUID.randomUUID()+"@guardian.test";
        profiles.register(s,input(true,old),true,true); em.flush();
        String token=deliver(s,AccountLinkPurpose.GUARDIAN_VERIFICATION,old);
        profiles.update(s.getId(),new UpdateSelfProfileRequest(s.getVersion(),input(true,UUID.randomUUID()+"@guardian.test")));
        assertThatThrownBy(() -> proofs.inspect(token)).hasMessageContaining("invalid");
        assertThat(guardians.findById(s.getId()).orElseThrow().getEmailVerifiedAt()).isNull();
    }
    @Test void contactProofsDoNotAuthorizePasswordReset() {
        var s=student(); profiles.register(s,input(false,null),false,true); em.flush();
        String token=deliver(s,AccountLinkPurpose.STUDENT_EMAIL,s.getUniversityEmail());
        assertThatThrownBy(() -> proofs.consumePasswordReset(token)).hasMessageContaining("invalid");
    }
    @Test void staleProfileVersionCannotOverwriteContactData() {
        var s=student(); profiles.register(s,input(false,null),true,true); em.flush();
        long version=s.getVersion();
        var first=new StudentProfileInput(s.getDateOfBirth(),"Updated school","","","",null);
        profiles.update(s.getId(),new UpdateSelfProfileRequest(version,first));
        assertThatThrownBy(() -> profiles.update(s.getId(),new UpdateSelfProfileRequest(version,input(false,null))))
                .hasMessageContaining("changed");
        assertThat(profiles.read(s.getId()).schoolName()).isEqualTo("Updated school");
    }
    @Test void minorCannotUseGuardianPermissionToEnterAdultFacePilot() {
        assertThatThrownBy(() -> profiles.validateRegistration(input(true,"guardian@example.test"),"FACE",true))
                .hasMessageContaining("adult volunteer pilot");
        assertThatThrownBy(() -> profiles.validateRegistration(input(true,null),"MANUAL",false))
                .hasMessageContaining("guardian is required");
    }
    @Test void legacySignupWithoutNewProfileKeepsApprovalContract() {
        var s=student(); profiles.register(s,null,true,true); em.flush();
        assertThatCode(() -> profiles.requireApproval(s)).doesNotThrowAnyException();
    }

    @Test void existingStudentWithGuardianStillUsesExistingApprovalContract() {
        var s=student(); profiles.register(s,input(true,UUID.randomUUID()+"@guardian.test"),false,false); em.flush();
        studentService.approveStudent(s.getId());
        assertThat(students.findById(s.getId()).orElseThrow().getApprovalStatus()).isEqualTo("APPROVED");
    }
    @Test void adultSelfSignupWithoutGuardianCanStillBeApprovedWithoutEmailVerification() {
        var s=student(); profiles.register(s,input(false,null),false,true); em.flush();
        studentService.approveStudent(s.getId());
        assertThat(students.findById(s.getId()).orElseThrow().getApprovalStatus()).isEqualTo("APPROVED");
    }
    @Test void unverifiedGuardianBlocksApprovalWithBadRequest() {
        var s=student(); profiles.register(s,input(true,UUID.randomUUID()+"@guardian.test"),false,true); em.flush();
        assertThatThrownBy(() -> studentService.approveStudent(s.getId()))
                .isInstanceOfSatisfying(org.springframework.web.server.ResponseStatusException.class,
                    error -> assertThat(error.getStatusCode().value()).isEqualTo(400));
    }
    @Test void sameStudentAndGuardianEmailIsRejectedCaseInsensitively() {
        var s=student();
        assertThatThrownBy(() -> profiles.register(s,input(true," "+s.getUniversityEmail().toUpperCase()+" "),false,true))
                .hasMessageContaining("must differ");
    }
    @Test void oldDateOfBirthCannotBeChangedToBypassGuardianRequirement() {
        var s=student(); profiles.register(s,input(true,UUID.randomUUID()+"@guardian.test"),false,true); em.flush();
        assertThatThrownBy(() -> profiles.update(s.getId(),new UpdateSelfProfileRequest(s.getVersion(),input(false,null))))
                .hasMessageContaining("date of birth");
    }
    @Test void staleGuardianReviewCannotApproveReplacementContact() {
        var s=student(); profiles.register(s,input(true,UUID.randomUUID()+"@guardian.test"),false,true); em.flush();
        var old=guardians.findById(s.getId()).orElseThrow().getRevision();
        profiles.update(s.getId(),new UpdateSelfProfileRequest(s.getVersion(),input(true,UUID.randomUUID()+"@guardian.test")));
        assertThatThrownBy(() -> profiles.confirmGuardian(s.getId(),UUID.randomUUID(),old,"ENROLMENT_RECORD"))
                .hasMessageContaining("changed");
    }
    @Test void studentIdAndEmailShareLoginBudgetAndAccount() {
        var s=student();
        s.setPasswordHash(new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder().encode("correct-password"));
        students.saveAndFlush(s);
        assertThat(authService.loginBudgetIdentity(s.getStudentNumber())).isEqualTo(s.getUniversityEmail());
        assertThat(authService.login(new LoginRequest(s.getStudentNumber(),"correct-password")).id()).isEqualTo(s.getId());
        assertThat(authService.login(new LoginRequest(s.getUniversityEmail(),"correct-password")).id()).isEqualTo(s.getId());
    }
}