package io.github.huijingmen.softeng789.classroommonitoring.livevideo;

import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;
import static io.github.huijingmen.softeng789.classroommonitoring.auth.BrowserTestSession.browserSession;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:live-video-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa",
    "spring.datasource.password=", "spring.jpa.hibernate.ddl-auto=create-drop", "live-video.enabled=true"
})
@ActiveProfiles("postgres")
@AutoConfigureMockMvc
class LiveVideoServiceTest {
    @Autowired LiveVideoService service;
    @Autowired StudentRepository students;
    @Autowired TeacherRepository teachers;
    @Autowired CourseRepository courses;
    @Autowired CourseOfferingRepository offerings;
    @Autowired CourseEnrollmentRepository enrollments;
    @Autowired ClassroomSessionRepository sessions;
    @Autowired AttendanceRecordRepository attendance;
    @Autowired SessionAuthService auth;
    @Autowired MockMvc mvc;
    Student student; Teacher teacher; ClassroomSession session; CourseEnrollment enrollment;
    String studentToken; String teacherToken;

    @BeforeEach void setup() {
        org.springframework.test.util.ReflectionTestUtils.setField(service, "clock", Clock.systemUTC());
        ((Map<?, ?>) org.springframework.test.util.ReflectionTestUtils.getField(service, "streams")).clear();
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        teacher = new Teacher(); teacher.setStaffNumber(suffix); teacher.setEmail(suffix + "@staff.test");
        teacher.setName("Observation Teacher"); teacher.setRole("TEACHER"); teacher = teachers.save(teacher);
        student = new Student(); student.setStudentNumber(suffix); student.setUniversityEmail(suffix + "@student.test");
        student.setFirstName("Pilot"); student.setLastName("Volunteer"); student.setCourse("TEST"); student.setSeat("A1"); student.setProgramme(""); student = students.save(student);
        Course course = new Course(); course.setCode(suffix); course.setName("Pilot Class"); course = courses.save(course);
        CourseOffering offering = new CourseOffering(); offering.setCourse(course); offering.setOfferingCode(suffix);
        offering.setAcademicTerm("2026"); offering.getTeachers().add(teacher); offering = offerings.save(offering);
        enrollment = new CourseEnrollment(); enrollment.setStudent(student); enrollment.setCourseOffering(offering); enrollment = enrollments.save(enrollment);
        session = new ClassroomSession(); session.setCourse("TEST"); session.setRoom("Test"); session.setCourseOffering(offering); session.setTeacher(teacher);
        session.setDate(LocalDate.now()); session.setStartTime(Instant.now().minusSeconds(60)); session.setEndTime(Instant.now().plusSeconds(3600)); session = sessions.save(session);
        teacherToken = auth.issueToken("TEACHER", teacher.getId(), teacher.getName(), teacher.getEmail(), "APPROVED").token();
        studentToken = auth.issueToken("STUDENT", student.getId(), student.getFullName(), student.getUniversityEmail(), "APPROVED").token();
    }
    LiveVideoService.Start consent(UUID id) { return new LiveVideoService.Start(id, true, true, LiveVideoService.NOTICE); }
    LiveVideoService.View start() { return service.start(student.getId(), session.getId(), consent(UUID.randomUUID())); }
    LiveVideoService.Signal signal(UUID viewer, String sdp) { return new LiveVideoService.Signal(viewer, sdp); }
    void rejected(Runnable action, int status) { assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(status)); }
    final String SDP = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";

    @Test void handshakeStopAndPrivacy() {
        var s = start(); var viewer = UUID.randomUUID();
        assertThat(service.watch(teacher.getId(), session.getId(), s.id(), signal(viewer, null)).sdp()).isNull();
        service.pulse(student.getId(), s.id(), signal(viewer, SDP));
        assertThat(service.board(teacher.getId(), session.getId()).streams().getFirst().sdp()).isNull();
        assertThat(service.watch(teacher.getId(), session.getId(), s.id(), signal(viewer, SDP)).sdp()).isEqualTo(SDP);
        var answer = service.pulse(student.getId(), s.id(), signal(viewer, null));
        assertThat(answer.sdp()).isEqualTo(SDP); assertThat(answer.viewerName()).isEqualTo(teacher.getName());
        service.stop(student.getId(), s.id()); service.stop(student.getId(), s.id());
        assertThat(service.board(teacher.getId(), session.getId()).streams()).isEmpty();
        assertThat(attendance.findBySession_Id(session.getId())).isEmpty();
    }
    @Test void consentEnrollmentAndClassWindowRequired() {
        rejected(() -> service.start(student.getId(), session.getId(), new LiveVideoService.Start(UUID.randomUUID(), true, false, LiveVideoService.NOTICE)), 400);
        rejected(() -> service.start(student.getId(), session.getId(), new LiveVideoService.Start(UUID.randomUUID(), false, true, LiveVideoService.NOTICE)), 400);
        student.setApprovalStatus("PENDING"); student = students.save(student); rejected(this::start, 403);
        student.setApprovalStatus("APPROVED"); student = students.save(student);
        session.setStartTime(Instant.now().plusSeconds(1800)); sessions.save(session); rejected(this::start, 409);
    }
    @Test void ownershipViewerIsolationAndVideoOnlyValidation() {
        var s = start(); var viewer = UUID.randomUUID();
        rejected(() -> service.pulse(UUID.randomUUID(), s.id(), signal(null, null)), 403);
        rejected(() -> service.stop(UUID.randomUUID(), s.id()), 403);
        service.watch(teacher.getId(), session.getId(), s.id(), signal(viewer, null));
        rejected(() -> service.watch(teacher.getId(), session.getId(), s.id(), signal(UUID.randomUUID(), null)), 409);
        rejected(() -> service.pulse(student.getId(), s.id(), signal(viewer, SDP + "m=audio 9 RTP/AVP 0")), 400);
        rejected(() -> service.pulse(student.getId(), s.id(), signal(viewer, SDP + "x".repeat(32000))), 400);
        rejected(this::start, 409);
    }
    @Test void releasingViewerDropsAllSdpAndAllowsNewTeacherWindow() {
        var s = start(); var first = UUID.randomUUID(); var second = UUID.randomUUID();
        service.watch(teacher.getId(), session.getId(), s.id(), signal(first, null));
        service.pulse(student.getId(), s.id(), signal(first, SDP));
        service.leave(teacher.getId(), session.getId(), s.id(), first);
        service.watch(teacher.getId(), session.getId(), s.id(), signal(second, null));
        // Delayed old offer cannot contaminate a new viewer's handshake.
        service.pulse(student.getId(), s.id(), signal(first, SDP));
        assertThat(service.watch(teacher.getId(), session.getId(), s.id(), signal(second, null)).sdp()).isNull();
        service.leave(teacher.getId(), session.getId(), s.id(), first);
        assertThat(service.pulse(student.getId(), s.id(), signal(null, null)).viewer()).isEqualTo(second);
    }
    @Test void expiredLeaseCannotBeRevived() {
        var s = start();
        org.springframework.test.util.ReflectionTestUtils.setField(service, "clock", Clock.offset(Clock.systemUTC(), Duration.ofSeconds(21)));
        rejected(() -> service.pulse(student.getId(), s.id(), signal(null, null)), 409);
        assertThat(service.board(teacher.getId(), session.getId()).streams()).isEmpty();
    }
    @Test void removalAndCancellationInvalidateActiveStreams() {
        var s = start(); enrollments.delete(enrollment);
        rejected(() -> service.pulse(student.getId(), s.id(), signal(null, null)), 403);
        assertThat(service.board(teacher.getId(), session.getId()).streams()).isEmpty();
    }
    @Test void cancellationEndsAnActiveStream() {
        var s = start();
        session.setStatus(ClassroomSession.SessionStatus.CANCELLED); sessions.save(session);
        final var stopped = s;
        rejected(() -> service.pulse(student.getId(), stopped.id(), signal(null, null)), 409);
    }
    @Test void onlyClassStaffMayWatch() {
        var s = start(); Teacher other = new Teacher(); String suffix = UUID.randomUUID().toString();
        other.setStaffNumber(suffix); other.setEmail(suffix + "@test.invalid"); other.setName("Other"); other.setRole("TEACHER"); teachers.save(other);
        rejected(() -> service.board(other.getId(), session.getId()), 403);
        rejected(() -> service.watch(other.getId(), session.getId(), s.id(), signal(UUID.randomUUID(), null)), 403);
    }
    @Test void fourStreamsPerClassAndGlobalStudentUniqueness() {
        start();
        for (int i = 0; i < 4; i++) {
            String suffix = UUID.randomUUID().toString(); Student p = new Student(); p.setStudentNumber(suffix); p.setUniversityEmail(suffix + "@test.invalid");
            p.setFirstName("Extra"); p.setLastName("Volunteer"); p.setCourse("TEST"); p.setSeat("A1"); p.setProgramme(""); students.save(p);
            CourseEnrollment e = new CourseEnrollment(); e.setStudent(p); e.setCourseOffering(enrollment.getCourseOffering()); enrollments.save(e);
            if (i < 3) service.start(p.getId(), session.getId(), consent(UUID.randomUUID()));
            else rejected(() -> service.start(p.getId(), session.getId(), consent(UUID.randomUUID())), 429);
        }
        assertThat(service.board(teacher.getId(), session.getId()).streams()).hasSize(4);
    }
    @Test void teacherLeaseExpiresWhileStudentKeepsSharing() {
        var s = start(); var viewer = UUID.randomUUID(); service.watch(teacher.getId(), session.getId(), s.id(), signal(viewer, null));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "clock", Clock.offset(Clock.systemUTC(), Duration.ofSeconds(15)));
        service.pulse(student.getId(), s.id(), signal(viewer, SDP));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "clock", Clock.offset(Clock.systemUTC(), Duration.ofSeconds(21)));
        assertThat(service.pulse(student.getId(), s.id(), signal(viewer, null)).viewer()).isNull();
        assertThat(service.watch(teacher.getId(), session.getId(), s.id(), signal(UUID.randomUUID(), null)).sdp()).isNull();
    }
    @Test void browserAuthCsrfAndStudentRoleEnforced() throws Exception {
        var path = "/api/live-video/students/" + student.getId() + "/sessions/" + session.getId() + "/streams";
        var body = "{\"id\":\"" + UUID.randomUUID() + "\",\"adultConfirmed\":true,\"consent\":true,\"noticeVersion\":\"" + LiveVideoService.NOTICE + "\"}";
        mvc.perform(get("/api/live-video/sessions/" + session.getId() + "/streams")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/live-video/sessions/" + session.getId() + "/streams").with(browserSession(studentToken))).andExpect(status().isForbidden());
        mvc.perform(post(path).cookie(new jakarta.servlet.http.Cookie("classlens-session", studentToken.replace("Bearer ", ""))).contentType("application/json").content(body)).andExpect(status().isForbidden());
        mvc.perform(post(path).with(browserSession(studentToken)).with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf()).contentType("application/json").content(body)).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
    }
}
