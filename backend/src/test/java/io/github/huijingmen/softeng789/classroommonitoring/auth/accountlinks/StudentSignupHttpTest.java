package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import io.github.huijingmen.softeng789.classroommonitoring.dto.*;
import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import jakarta.servlet.http.Cookie;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import tools.jackson.databind.ObjectMapper;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
    "spring.datasource.url=jdbc:h2:mem:signup-http-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa",
    "spring.datasource.password=","spring.jpa.hibernate.ddl-auto=create-drop"})
@ActiveProfiles("postgres") @AutoConfigureMockMvc @Import(AccountLinkTestInbox.class)
class StudentSignupHttpTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired StudentRepository students;
    @Autowired StudentGuardianRepository guardians;
    @Autowired TeacherRepository teachers;
    @Autowired AccountLinkRepository links;
    @Autowired StudentSignupProfiles profiles;
    @Autowired StudentContactVerification contacts;
    @Autowired AccountLinkWorker worker;
    @Autowired AccountLinkTestInbox.Inbox inbox;
    @Autowired SessionAuthService sessions;
    @Autowired io.github.huijingmen.softeng789.classroommonitoring.service.AuthService registration;
    @Autowired io.github.huijingmen.softeng789.classroommonitoring.service.StudentService studentService;
    @Autowired CourseRepository courses;
    @Autowired CourseOfferingRepository offerings;
    @Autowired AccountLinkRequests mailRequests;
    private record Csrf(Cookie cookie, String token) {}
    Csrf csrf() throws Exception {
        var result=mvc.perform(get("/api/auth/csrf")).andExpect(status().isOk()).andReturn();
        String header=result.getResponse().getHeaders("Set-Cookie").stream().filter(s -> s.startsWith("classlens-csrf=")).findFirst().orElseThrow();
        return new Csrf(new Cookie("classlens-csrf",header.substring(15,header.indexOf(';'))),
                json.readTree(result.getResponse().getContentAsString()).get("token").asText());
    }
    Student student() {
        var s=new Student(); String unique=UUID.randomUUID().toString();
        s.setStudentNumber("TEST-"+unique); s.setUniversityEmail(unique+"@student.test");
        s.setFirstName("Sample"); s.setLastName("Student"); s.setCourse("Test");
        s.setSeat("A1"); s.setProgramme(""); s.setPasswordHash("hash"); s.setApprovalStatus("PENDING");
        s.setSignupChecksRequired(true); s=students.saveAndFlush(s);
        var input=new StudentProfileInput(LocalDate.of(2015,1,1),"School","","","",
                new StudentProfileInput.GuardianInput("Sample Guardian","Parent",unique+"@guardian.test","020000000"));
        profiles.update(s.getId(),new UpdateSelfProfileRequest(s.getVersion(),input));
        return students.findById(s.getId()).orElseThrow();
    }
    String guardianToken(Student s) {
        contacts.request(s.getId(),AccountLinkPurpose.GUARDIAN_VERIFICATION); worker.deliverNext();
        return inbox.take(guardians.findById(s.getId()).orElseThrow().getEmail());
    }
    MvcResult confirm(String token, boolean permission) throws Exception {
        var proof=csrf();
        var body=new HashMap<String,Object>(); body.put("token",token); body.put("signupPermission",permission); body.put("noticeVersion",StudentSignupProfiles.GUARDIAN_NOTICE);
        return mvc.perform(post("/api/auth/account-links/confirm-contact").cookie(proof.cookie())
                .header("X-CSRF-TOKEN",proof.token()).contentType("application/json").content(json.writeValueAsString(body))).andReturn();
    }
    @Test void guardianCanInspectAndConfirmWithoutLoginAndSeesOnlyMinimumInformation() throws Exception {
        var s=student(); String token=guardianToken(s); var proof=csrf();
        var result=mvc.perform(post("/api/auth/account-links/inspect").cookie(proof.cookie()).header("X-CSRF-TOKEN",proof.token())
                .contentType("application/json").content(json.writeValueAsString(Map.of("token",token))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.studentName").value("Sample Student"))
                .andExpect(jsonPath("$.email").doesNotExist()).andReturn();
        String body=result.getResponse().getContentAsString();
        assertThat(body).doesNotContain(s.getUniversityEmail(),s.getStudentNumber(),"guardian.test","020000000",s.getId().toString());
        assertThat(confirm(token,true).getResponse().getStatus()).isEqualTo(204);
        var g=guardians.findById(s.getId()).orElseThrow();
        assertThat(g.getEmailVerifiedAt()).isNotNull();
        assertThat(g.getSignupConsentedAt()).isNotNull();
        assertThat(g.getRelationshipConfirmedAt()).isNull();
        assertThat(students.findById(s.getId()).orElseThrow().isConsentGiven()).isFalse();
        assertThat(students.findById(s.getId()).orElseThrow().getApprovalStatus()).isEqualTo("PENDING");
    }
    @Test void unknownExpiredUsedAndMissingProofsHaveSameErrorAndConsentIsExplicit() throws Exception {
        var s=student(); String token=guardianToken(s);
        assertThat(confirm(token,false).getResponse().getStatus()).isEqualTo(400);
        assertThat(guardians.findById(s.getId()).orElseThrow().getEmailVerifiedAt()).isNull();
        assertThat(confirm(token,true).getResponse().getStatus()).isEqualTo(204);
        var used=confirm(token,true);
        var unknown=confirm("x".repeat(43),true);
        var missing=confirm(null,true);
        var other=student(); String expired=guardianToken(other);
        var link=links.findByCredentialDigest(AccountLinkSecrets.digest(expired)).orElseThrow();
        link.dispatch(link.getCredentialDigest(),link.getAccountId(),link.getAccountRole(),link.getPasswordFingerprint(),Instant.now().minusSeconds(3600));
        links.saveAndFlush(link);
        var expiredResult=confirm(expired,true);
        String expected=json.readTree(used.getResponse().getContentAsString()).path("detail").asText();
        assertThat(expected).contains("invalid, expired or already used");
        for (var result:List.of(used,unknown,missing,expiredResult)) {
            assertThat(result.getResponse().getStatus()).isEqualTo(400);
            assertThat(json.readTree(result.getResponse().getContentAsString()).path("detail").asText()).isEqualTo(expected);
        }
    }
    @Test void contactConfirmationRequiresCsrfAndOtherNewRoutesRequireLogin() throws Exception {
        mvc.perform(post("/api/auth/account-links/confirm-contact").contentType("application/json").content("{}")).andExpect(status().isForbidden());
        mvc.perform(get("/api/auth/signup/profile")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/students/"+UUID.randomUUID()+"/signup-profile")).andExpect(status().isUnauthorized());
        var proof=csrf();
        mvc.perform(put("/api/auth/signup/profile").cookie(proof.cookie()).header("X-CSRF-TOKEN",proof.token())
                .contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/signup/verification").cookie(proof.cookie()).header("X-CSRF-TOKEN",proof.token())
                .contentType("application/json").content("{\"purpose\":\"GUARDIAN_VERIFICATION\"}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/students/"+UUID.randomUUID()+"/guardian-confirmation").cookie(proof.cookie())
                .header("X-CSRF-TOKEN",proof.token()).contentType("application/json").content("{}")).andExpect(status().isUnauthorized());
    }
    Cookie session(Student s) {
        return new Cookie("classlens-session",sessions.issueToken("STUDENT",s.getId(),s.getFullName(),s.getUniversityEmail(),s.getApprovalStatus()).token());
    }
    @Test void pendingStudentCanEditOnlyOwnContactProfileAndCannotReadPortalOrApproveGuardian() throws Exception {
        var one=student(); var two=student(); var cookie=session(one);
        mvc.perform(get("/api/auth/signup/profile").cookie(cookie)).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(one.getId().toString()));
        mvc.perform(get("/api/students/"+two.getId()+"/signup-profile").cookie(cookie)).andExpect(status().isForbidden());
        mvc.perform(get("/api/students/"+one.getId()).cookie(cookie)).andExpect(status().isForbidden());
        var proof=csrf();
        mvc.perform(post("/api/students/"+one.getId()+"/guardian-confirmation").cookie(cookie,proof.cookie())
                .header("X-CSRF-TOKEN",proof.token()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("revision",guardians.findById(one.getId()).orElseThrow().getRevision(),
                        "method","ENROLMENT_RECORD","relationshipConfirmed",true)))).andExpect(status().isForbidden());
    }
    @Test void teacherCannotUseSelfProfileOrAdminGuardianEndpoints() throws Exception {
        var t=new Teacher(); String unique=UUID.randomUUID().toString();
        t.setStaffNumber(unique);t.setEmail(unique+"@staff.test");t.setName("Test Teacher");t.setRole("TEACHER");t=teachers.saveAndFlush(t);
        var cookie=new Cookie("classlens-session",sessions.issueToken("TEACHER",t.getId(),t.getName(),t.getEmail(),"APPROVED").token());
        mvc.perform(get("/api/auth/signup/profile").cookie(cookie)).andExpect(status().isForbidden());
        mvc.perform(get("/api/students/"+student().getId()+"/signup-profile").cookie(cookie)).andExpect(status().isForbidden());
    }

    CourseOffering offering() {
        String unique=UUID.randomUUID().toString();
        var course=new Course(); course.setCode(unique); course.setName("Signup test"); course=courses.saveAndFlush(course);
        var offering=new CourseOffering(); offering.setCourse(course); offering.setOfferingCode(unique);
        offering.setAcademicTerm("2026"); return offerings.saveAndFlush(offering);
    }
    RegisterStudentRequest registrationRequest(String number, String email, String proof, CourseOffering offering) {
        return new RegisterStudentRequest(number,email,"Sample Student",offering.getCourse().getCode(),List.of(offering.getId()),
                "correct-password",false,StudentLevel.LEVEL_1,"MANUAL",false,null,proof,
                new StudentProfileInput(LocalDate.of(2015,1,1),"School","Address","020000000","",
                    new StudentProfileInput.GuardianInput("Sample Guardian","Parent",UUID.randomUUID()+"@guardian.test","021000000")));
    }
    @Test void realMinorSignupRetainsProfileThroughFaceFlowAndNeedsIndependentAdminConfirmation() throws Exception {
        var request=registrationRequest("TEST-"+UUID.randomUUID(),UUID.randomUUID()+"@student.test",null,offering());
        var auth=registration.registerStudent(request,null,List.of());
        var s=students.findById(auth.id()).orElseThrow();
        assertThat(s.getDateOfBirth()).isEqualTo(LocalDate.of(2015,1,1));
        assertThat(s.isSignupChecksRequired()).isTrue();
        assertThatThrownBy(() -> studentService.approveStudent(s.getId())).hasMessageContaining("Guardian");
        String token=guardianToken(s);
        assertThat(confirm(token,true).getResponse().getStatus()).isEqualTo(204);
        assertThatThrownBy(() -> studentService.approveStudent(s.getId())).hasMessageContaining("independent relationship");

        var admin=new Teacher(); String unique=UUID.randomUUID().toString();
        admin.setStaffNumber(unique); admin.setEmail(unique+"@admin.test"); admin.setName("Test Admin"); admin.setRole("ADMIN");
        admin=teachers.saveAndFlush(admin);
        var cookie=new Cookie("classlens-session",sessions.issueToken("ADMIN",admin.getId(),admin.getName(),admin.getEmail(),"APPROVED").token());
        var csrf=csrf();
        mvc.perform(post("/api/students/"+s.getId()+"/guardian-confirmation").cookie(cookie,csrf.cookie())
                .header("X-CSRF-TOKEN",csrf.token()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("revision",guardians.findById(s.getId()).orElseThrow().getRevision(),
                        "method","ENROLMENT_RECORD","relationshipConfirmed",true))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.guardian.relationshipConfirmedAt").isNotEmpty());
        studentService.approveStudent(s.getId(),admin.getId(),true);
        assertThat(students.findById(s.getId()).orElseThrow().getApprovalStatus()).isEqualTo("APPROVED");
        assertThat(students.findById(s.getId()).orElseThrow().isConsentGiven()).isFalse();
    }
    @Test void staffCreatedRecordStillRequiresBoundActivationProofAndRetainsApprovalExemption() {
        var s=student(); s.setPasswordHash(null); s.setApprovalStatus("APPROVED"); s=students.saveAndFlush(s);
        var offering=offering();
        var noProof=registrationRequest(s.getStudentNumber(),s.getUniversityEmail(),null,offering);
        assertThatThrownBy(() -> registration.registerStudent(noProof,null,List.of())).hasMessageContaining("activate");
        mailRequests.request(s.getUniversityEmail(),AccountLinkPurpose.STUDENT_REGISTRATION); worker.deliverNext();
        var request=registrationRequest(s.getStudentNumber(),s.getUniversityEmail(),inbox.take(s.getUniversityEmail()),offering);
        var auth=registration.registerStudent(request,null,List.of());
        assertThat(auth.id()).isEqualTo(s.getId());
        assertThat(students.findById(s.getId()).orElseThrow().getStudentNumber()).isEqualTo(s.getStudentNumber());
        assertThat(students.findById(s.getId()).orElseThrow().isSignupChecksRequired()).isFalse();
        var admin=new Teacher(); String unique=UUID.randomUUID().toString();
        admin.setStaffNumber(unique);admin.setEmail(unique+"@admin.test");admin.setName("Test Admin");admin.setRole("ADMIN");
        admin=teachers.saveAndFlush(admin);
        studentService.approveStudent(s.getId(),admin.getId(),true);
        assertThat(students.findById(s.getId()).orElseThrow().getApprovalStatus()).isEqualTo("APPROVED");
    }
}
