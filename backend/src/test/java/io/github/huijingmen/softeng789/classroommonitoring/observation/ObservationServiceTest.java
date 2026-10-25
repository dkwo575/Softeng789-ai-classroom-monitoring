package io.github.huijingmen.softeng789.classroommonitoring.observation;

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
    "spring.datasource.url=jdbc:h2:mem:webcam-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE",
    "spring.datasource.driver-class-name=org.h2.Driver", "spring.datasource.username=sa",
    "spring.datasource.password=", "spring.jpa.hibernate.ddl-auto=create-drop", "webcam.sharing-enabled=true"
})
@ActiveProfiles("postgres")
@AutoConfigureMockMvc
class ObservationServiceTest {
    @Autowired ObservationService service;
    @Autowired SharingRunRepository runs;
    @Autowired WebcamObservationRepository events;
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
    ObservationService.Start consent(UUID id) { return new ObservationService.Start(id, true, true, ObservationService.NOTICE); }
    ObservationService.RunView start() { return service.start(student.getId(), session.getId(), consent(UUID.randomUUID())); }
    ObservationService.Pulse pulse(long sequence) {
        return new ObservationService.Pulse(sequence, ObservationService.Camera.RUNNING,
                List.of(new ObservationService.Sample(ObservationService.Kind.NO_FACE, 10000)));
    }
    ObservationService.Dashboard dashboard() { return service.dashboard(teacher.getId(), session.getId(), 0); }
    void assertRejected(Runnable action, int status) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ResponseStatusException.class, e -> assertThat(e.getStatusCode().value()).isEqualTo(status));
    }
    @Test void optInPulseReviewAndWithdrawalNeverWriteAttendance() {
        assertThat(service.workspace(student.getId()).sessions()).hasSize(1);
        var run = start();
        assertThat(run.state()).isEqualTo("STARTING");
        service.pulse(student.getId(), run.id(), pulse(1));
        assertThat(dashboard().students().getFirst().connection().state()).isEqualTo("RUNNING");
        var event = dashboard().events().getFirst();
        assertThat(event.kind()).isEqualTo("NO_FACE");
        var reviewed = service.review(teacher.getId(), event.id(), new ObservationService.Review(ObservationService.Decision.REVIEWED));
        assertThat(reviewed.reviewState()).isEqualTo("REVIEWED");
        assertThat(attendance.findBySession_Id(session.getId())).isEmpty();
        service.withdraw(student.getId());
        assertThat(dashboard().events()).isEmpty();
        assertThat(dashboard().students().getFirst().connection()).isNull();
        assertThat(runs.findById(run.id())).isEmpty(); assertThat(events.findById(event.id())).isEmpty();
    }
    @Test void consentAndActiveAccountAreRequired() {
        assertRejected(() -> service.start(student.getId(), session.getId(), new ObservationService.Start(UUID.randomUUID(), false, true, ObservationService.NOTICE)), 400);
        assertRejected(() -> service.start(student.getId(), session.getId(), new ObservationService.Start(UUID.randomUUID(), true, false, ObservationService.NOTICE)), 400);
        assertRejected(() -> service.start(student.getId(), session.getId(), new ObservationService.Start(UUID.randomUUID(), true, true, "old")), 400);
        student.setApprovalStatus("PENDING"); students.save(student); assertRejected(this::start, 403);
    }
    @Test void sessionWindowAndCancellationAreRecheckedDuringSharing() {
        session.setStartTime(Instant.now().plusSeconds(1800)); sessions.save(session); assertRejected(this::start, 409);
        session.setStartTime(Instant.now().minusSeconds(60)); sessions.save(session); var run = start();
        session.setStatus(ClassroomSession.SessionStatus.CANCELLED); sessions.save(session);
        assertRejected(() -> service.pulse(student.getId(), run.id(), pulse(1)), 409);
        assertThat(dashboard().students().getFirst().connection().state()).isEqualTo("SESSION_CLOSED");
        service.stop(student.getId(), run.id());
    }
    @Test void removedEnrollmentCannotSendOrExposeEvents() {
        var run = start(); service.pulse(student.getId(), run.id(), pulse(1));
        var event = dashboard().events().getFirst();
        enrollments.delete(enrollment);
        assertRejected(() -> service.pulse(student.getId(), run.id(), pulse(2)), 403);
        assertRejected(() -> service.review(teacher.getId(), event.id(), new ObservationService.Review(ObservationService.Decision.REVIEWED)), 403);
        assertThat(dashboard().students()).isEmpty(); assertThat(dashboard().events()).isEmpty();
        service.withdraw(student.getId());
    }
    @Test void duplicateStartAndPulseAreIdempotentWithoutExtendingLease() {
        UUID id = UUID.randomUUID(); var first = service.start(student.getId(), session.getId(), consent(id));
        assertThat(service.start(student.getId(), session.getId(), consent(id)).id()).isEqualTo(first.id());
        var received = service.pulse(student.getId(), id, pulse(1));
        var retry = service.pulse(student.getId(), id, pulse(1));
        assertThat(retry.lastHeartbeat()).isCloseTo(received.lastHeartbeat(), within(1, java.time.temporal.ChronoUnit.MICROS));
        assertThat(dashboard().events()).hasSize(1);
        assertRejected(() -> service.pulse(student.getId(), id, pulse(3)), 409);
        assertRejected(() -> service.pulse(student.getId(), id, pulse(2)), 429);
    }
    @Test void disconnectedLeaseCannotBeRevivedOrMistakenForNoFace() {
        var run = start(); var row = runs.findById(run.id()).orElseThrow();
        row.lastHeartbeat = Instant.now().minusSeconds(36); runs.save(row);
        assertThat(dashboard().students().getFirst().connection().state()).isEqualTo("DISCONNECTED");
        assertThat(dashboard().events()).isEmpty();
        assertRejected(() -> service.pulse(student.getId(), run.id(), pulse(1)), 409);
        assertRejected(() -> service.start(student.getId(), session.getId(), consent(run.id())), 409);
        assertThat(start().id()).isNotEqualTo(run.id());
    }
    @Test void stopIsIdempotentAndCannotBeReopenedByLateHeartbeat() {
        var run = start(); service.stop(student.getId(), run.id()); service.stop(student.getId(), run.id());
        assertThat(dashboard().students().getFirst().connection().state()).isEqualTo("STOPPED");
        assertRejected(() -> service.pulse(student.getId(), run.id(), pulse(1)), 409);
    }
    @Test void simultaneousStartsLeaveOnlyOneOpenRun() throws Exception {
        try (var pool = Executors.newFixedThreadPool(2)) {
            var gate = new CountDownLatch(1);
            var a = pool.submit(() -> { gate.await(); return start(); });
            var b = pool.submit(() -> { gate.await(); return start(); }); gate.countDown();
            a.get(15, TimeUnit.SECONDS); b.get(15, TimeUnit.SECONDS);
            assertThat(runs.findByStudentIdAndExpiresAtAfterOrderByCreatedAtDesc(student.getId(), Instant.now()).stream().filter(r -> r.stoppedAt == null)).hasSize(1);
        }
    }
    @Test void expiryIsHiddenBeforePhysicalPurgeAndReviewIsBlocked() {
        var run = start(); service.pulse(student.getId(), run.id(), pulse(1)); var event = dashboard().events().getFirst();
        var row = runs.findById(run.id()).orElseThrow(); row.expiresAt = Instant.now().minusSeconds(1); runs.save(row);
        assertThat(dashboard().events()).isEmpty();
        assertRejected(() -> service.review(teacher.getId(), event.id(), new ObservationService.Review(ObservationService.Decision.REVIEWED)), 409);
        service.purgeExpired(); assertThat(runs.findById(run.id())).isEmpty(); assertThat(events.findById(event.id())).isEmpty();
    }
    @Test void reviewCannotSilentlyOverwriteAnotherDecision() {
        var run = start(); service.pulse(student.getId(), run.id(), pulse(1)); var id = dashboard().events().getFirst().id();
        var decision = new ObservationService.Review(ObservationService.Decision.FALSE_POSITIVE);
        var first = service.review(teacher.getId(), id, decision);
        assertThat(service.review(teacher.getId(), id, decision).reviewedAt()).isCloseTo(first.reviewedAt(), within(1, java.time.temporal.ChronoUnit.MICROS));
        assertRejected(() -> service.review(teacher.getId(), id, new ObservationService.Review(ObservationService.Decision.REVIEWED)), 409);
    }
    @Test void anotherTeacherCannotReadOrReviewClass() {
        var run = start(); service.pulse(student.getId(), run.id(), pulse(1)); var event = dashboard().events().getFirst();
        Teacher other = new Teacher(); String suffix = UUID.randomUUID().toString();
        other.setStaffNumber(suffix); other.setEmail(suffix + "@test.invalid"); other.setName("Other"); other.setRole("TEACHER"); teachers.save(other);
        assertRejected(() -> service.dashboard(other.getId(), session.getId(), 0), 403);
        assertRejected(() -> service.review(other.getId(), event.id(), new ObservationService.Review(ObservationService.Decision.REVIEWED)), 403);
    }
    @Test void pausedAnalysisKeepsLeaseButCannotCarryFaceEvents() {
        var run = start();
        var paused = service.pulse(student.getId(), run.id(), new ObservationService.Pulse(1, ObservationService.Camera.PAUSED, List.of()));
        assertThat(paused.state()).isEqualTo("PAUSED");
        assertThat(dashboard().events()).isEmpty();
        var row = runs.findById(run.id()).orElseThrow(); row.lastHeartbeat = Instant.now().minusSeconds(2); runs.save(row);
        assertRejected(() -> service.pulse(student.getId(), run.id(), new ObservationService.Pulse(2, ObservationService.Camera.PAUSED, pulse(2).events())), 409);
        assertThat(service.pulse(student.getId(), run.id(), pulse(2)).state()).isEqualTo("RUNNING");
        assertThat(dashboard().events()).hasSize(1);
    }
    @Test void routineEventsAreInformationalAndSummaryCoversMoreThanOnePage() {
        var run = start();
        service.pulse(student.getId(), run.id(), new ObservationService.Pulse(1, ObservationService.Camera.RUNNING, List.of(
            new ObservationService.Sample(ObservationService.Kind.ONE_FACE, 1000),
            new ObservationService.Sample(ObservationService.Kind.HEAD_TURN, 2000))));
        assertThat(dashboard().events()).isEmpty();
        var history = service.dashboard(teacher.getId(), session.getId(), 0, false);
        assertThat(history.events()).hasSize(2).allMatch(e -> e.reviewState().equals("INFO"));
        assertRejected(() -> service.review(teacher.getId(), history.events().getFirst().id(), new ObservationService.Review(ObservationService.Decision.REVIEWED)), 409);
        List<WebcamObservation> extra = new ArrayList<>();
        for (int i = 0; i < 61; i++) {
            var e = new WebcamObservation(); e.id = UUID.randomUUID(); e.runId = run.id(); e.kind = "NO_FACE";
            e.durationMs = 10000; e.receivedAt = Instant.now(); e.reviewState = "PENDING"; extra.add(e);
        }
        events.saveAll(extra);
        var board = dashboard(); assertThat(board.events()).hasSize(50); assertThat(board.hasMore()).isTrue();
        assertThat(board.students().getFirst().summary().headMovements()).isEqualTo(1);
        assertThat(board.students().getFirst().summary().noFaceReports()).isEqualTo(61);
        assertThat(board.students().getFirst().summary().pendingChecks()).isEqualTo(61);
        assertThat(service.dashboard(teacher.getId(), session.getId(), 1).events()).hasSize(11);
    }
    @Test void groupReviewIsAtomicAndOnlyChangesExplicitlySelectedReports() {
        var run = start();
        service.pulse(student.getId(), run.id(), new ObservationService.Pulse(1, ObservationService.Camera.RUNNING,
            List.of(pulse(1).events().getFirst(), pulse(1).events().getFirst(), pulse(1).events().getFirst())));
        var ids = dashboard().events().stream().map(ObservationService.EventView::id).sorted().toList();
        service.review(teacher.getId(), ids.get(1), new ObservationService.Review(ObservationService.Decision.FALSE_POSITIVE));
        assertRejected(() -> service.reviewBatch(teacher.getId(), session.getId(), new ObservationService.ReviewBatch(ids, ObservationService.Decision.REVIEWED)), 409);
        assertThat(events.findById(ids.getFirst()).orElseThrow().reviewState).isEqualTo("PENDING");
        var selected = List.of(ids.getFirst(), ids.get(2));
        assertThat(service.reviewBatch(teacher.getId(), session.getId(), new ObservationService.ReviewBatch(selected, ObservationService.Decision.REVIEWED))).hasSize(2);
        assertThat(dashboard().events()).isEmpty();
        assertThat(events.findById(ids.get(1)).orElseThrow().reviewState).isEqualTo("FALSE_POSITIVE");
        assertThat(attendance.findBySession_Id(session.getId())).isEmpty();
    }
    @Test void groupReviewRejectsReportsFromAnotherSession() {
        var run = start(); service.pulse(student.getId(), run.id(), pulse(1));
        var id = dashboard().events().getFirst().id();
        var other = new ClassroomSession(); other.setTeacher(teacher); other.setCourse("Other"); other.setRoom("Test");
        other.setDate(LocalDate.now()); other.setStartTime(Instant.now()); other.setEndTime(Instant.now().plusSeconds(3600)); sessions.save(other);
        assertRejected(() -> service.reviewBatch(teacher.getId(), other.getId(), new ObservationService.ReviewBatch(List.of(id), ObservationService.Decision.REVIEWED)), 403);
        assertThat(events.findById(id).orElseThrow().reviewState).isEqualTo("PENDING");
    }
    @Test void httpRequiresAuthenticationSelfOwnershipAndCsrf() throws Exception {
        String base = "/api/webcam/students/" + student.getId();
        mvc.perform(get(base + "/sessions")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/webcam/students/" + UUID.randomUUID() + "/sessions").with(browserSession(studentToken))).andExpect(status().isForbidden());
        mvc.perform(get("/api/webcam/sessions/" + session.getId() + "/observations").with(browserSession(studentToken))).andExpect(status().isForbidden());
        mvc.perform(get(base + "/sessions").with(browserSession(studentToken))).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(delete(base + "/sharing").cookie(new jakarta.servlet.http.Cookie("classlens-session", studentToken))).andExpect(status().isForbidden());
    }
    @Test void httpRejectsUnknownKindsInvalidDurationsAndOversizedBatch() throws Exception {
        var run = start(); String path = "/api/webcam/students/" + student.getId() + "/runs/" + run.id() + "/pulse";
        for (String sample : List.of("{\"kind\":\"SLEEPING\",\"durationMs\":10000}", "{\"kind\":\"NO_FACE\",\"durationMs\":2}", "{\"kind\":\"ONE_FACE\",\"durationMs\":60001}"))
            mvc.perform(post(path).with(browserSession(studentToken)).contentType("application/json").content("{\"sequence\":1,\"camera\":\"RUNNING\",\"events\":[" + sample + "]}")).andExpect(status().isBadRequest());
        String samples = String.join(",", Collections.nCopies(11, "{\"kind\":\"ONE_FACE\",\"durationMs\":1000}"));
        mvc.perform(post(path).with(browserSession(studentToken)).contentType("application/json").content("{\"sequence\":1,\"camera\":\"RUNNING\",\"events\":[" + samples + "]}")).andExpect(status().isBadRequest());
        assertThat(dashboard().events()).isEmpty();
    }
}
