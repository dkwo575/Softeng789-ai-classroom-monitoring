package io.github.huijingmen.softeng789.classroommonitoring.observation;

import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import io.github.huijingmen.softeng789.classroommonitoring.service.StaffAccessService;
import jakarta.persistence.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

/** Voluntary adult pilot: client-reported observations are never attendance or behaviour judgments. */
@Service
@Transactional
public class ObservationService {
    public static final String NOTICE = "webcam-sharing-adult-pilot-v1";
    public static final int LEASE_SECONDS = 35;
    private final SharingRunRepository runs;
    private final WebcamObservationRepository events;
    private final ClassroomSessionRepository sessions;
    private final CourseEnrollmentRepository enrollments;
    private final StaffAccessService access;
    private final EntityManager em;
    private final boolean enabled;

    public ObservationService(SharingRunRepository runs, WebcamObservationRepository events,
            ClassroomSessionRepository sessions, CourseEnrollmentRepository enrollments,
            StaffAccessService access, EntityManager em,
            @Value("${webcam.sharing-enabled:false}") boolean enabled) {
        this.runs = runs; this.events = events; this.sessions = sessions; this.enrollments = enrollments;
        this.access = access; this.em = em; this.enabled = enabled;
    }
    public enum Kind { NO_FACE, ONE_FACE, MULTIPLE_FACES, HEAD_TURN, HEAD_TILT, POSE_UNAVAILABLE }
    public enum Camera { STARTING, RUNNING, PAUSED }
    public enum Decision { REVIEWED, FALSE_POSITIVE }
    public record Start(@NotNull UUID id, @AssertTrue boolean adultConfirmed, @AssertTrue boolean sharingConsent,
                        @NotNull @Size(max = 80) String noticeVersion) {}
    public record Sample(@NotNull Kind kind, @Min(1000) @Max(60000) int durationMs) {}
    public record Pulse(@Min(1) long sequence, @NotNull Camera camera, @NotNull @Size(max = 10) List<@NotNull @Valid Sample> events) {}
    public record Review(@NotNull Decision decision) {}
    public record ReviewBatch(@NotNull @Size(min = 1, max = 50) List<@NotNull UUID> ids, @NotNull Decision decision) {}
    public record SessionOption(UUID id, String course, Instant startTime, Instant endTime, boolean open) {}
    public record Workspace(boolean enabled, String noticeVersion, List<SessionOption> sessions) {}
    public record RunView(UUID id, String state, Instant lastHeartbeat, Instant expiresAt, long sequence) {}
    public record EventView(UUID id, UUID studentId, String kind, int durationMs, Instant receivedAt,
                            String reviewState, Instant reviewedAt) {}
    public record Summary(long headMovements, long noFaceReports, long multipleFaceReports, long pendingChecks) {}
    public record StudentView(UUID id, String name, RunView connection, Summary summary) {}
    public record Dashboard(boolean enabled, Instant serverTime, List<StudentView> students,
                            List<EventView> events, boolean hasMore, int page) {}

    public Workspace workspace(UUID student) {
        eligible(student);
        Instant now = Instant.now();
        return new Workspace(enabled, NOTICE, !enabled ? List.of() : sessions.findCheckInSessions(student,
                now.minusSeconds(86400), now.plusSeconds(86400)).stream()
                .map(s -> new SessionOption(s.getId(), s.getCourse(), s.getStartTime(), s.getEndTime(), open(s, now))).toList());
    }

    public RunView start(UUID student, UUID session, Start body) {
        requireEnabled(); eligible(student); membership(student, session, true);
        if (!body.adultConfirmed() || !body.sharingConsent() || !NOTICE.equals(body.noticeVersion()) || body.id() == null)
            throw new ResponseStatusException(BAD_REQUEST, "Adult volunteer confirmation and current sharing consent are required.");
        Instant now = Instant.now();
        var previous = runs.findById(body.id());
        if (previous.isPresent()) {
            SharingRun existing = owned(student, body.id());
            if (!existing.sessionId.equals(session)) throw conflict("Start key belongs to another session.");
            requireLive(existing, now); return view(existing, now, true);
        }
        var retained = runs.findByStudentIdAndExpiresAtAfterOrderByCreatedAtDesc(student, now);
        if (retained.size() >= 20) throw new ResponseStatusException(TOO_MANY_REQUESTS, "Pilot limit: 20 starts in 24 hours.");
        // Student row lock serializes starts across tabs and sessions. A fresh start replaces the old lease.
        for (var prior : retained) if (prior.stoppedAt == null) { prior.stoppedAt = now; prior.cameraState = "STOPPED"; }
        SharingRun run = new SharingRun(); run.id = body.id(); run.studentId = student; run.sessionId = session;
        run.noticeVersion = NOTICE; run.createdAt = now; run.expiresAt = now.plusSeconds(86400);
        run.lastHeartbeat = now; run.cameraState = "STARTING"; runs.save(run);
        return view(run, now, true);
    }

    public RunView pulse(UUID student, UUID id, Pulse body) {
        requireEnabled(); eligible(student);
        var run = owned(student, id); membership(student, run.sessionId, true);
        Instant now = Instant.now(); requireLive(run, now);
        if (body.sequence() == run.sequence) return view(run, now, true); // A retry cannot renew a lease or duplicate events.
        if (body.sequence() != run.sequence + 1) throw conflict("Out-of-order heartbeat. Restart sharing.");
        if (run.sequence > 0 && run.lastHeartbeat.plusSeconds(1).isAfter(now))
            throw new ResponseStatusException(TOO_MANY_REQUESTS, "Heartbeat is too frequent.");
        if (body.camera() == null || body.events() == null || body.events().size() > 10)
            throw new ResponseStatusException(BAD_REQUEST, "Invalid heartbeat.");
        if ("RUNNING".equals(run.cameraState) && body.camera() == Camera.STARTING) throw conflict("Camera cannot return to starting.");
        if (body.camera() != Camera.RUNNING && !body.events().isEmpty()) throw conflict("Camera is not running.");
        if (events.countByRunId(id) + body.events().size() > 600)
            throw new ResponseStatusException(TOO_MANY_REQUESTS, "Pilot limit: 600 observations per run. Stop sharing.");
        for (Sample sample : body.events()) {
            int minimum = sample.kind() == Kind.NO_FACE ? 10000 : sample.kind() == Kind.ONE_FACE ? 1000 : 2000;
            if (sample.kind() == null || sample.durationMs() < minimum || sample.durationMs() > 60000)
                throw new ResponseStatusException(BAD_REQUEST, "Observation duration is outside the pilot thresholds.");
            WebcamObservation event = new WebcamObservation(); event.id = UUID.randomUUID(); event.runId = id;
            event.kind = sample.kind().name(); event.durationMs = sample.durationMs(); event.receivedAt = now;
            event.reviewState = requiresCheck(event.kind) ? "PENDING" : "INFO"; events.save(event);
        }
        run.sequence = body.sequence(); run.lastHeartbeat = now; run.cameraState = body.camera().name();
        return view(run, now, true);
    }

    public void stop(UUID student, UUID id) {
        // Still allowed after feature disablement, account changes or class cancellation.
        lockStudent(student); var run = owned(student, id);
        if (run.stoppedAt == null) run.stoppedAt = Instant.now();
        run.cameraState = "STOPPED";
    }

    public void withdraw(UUID student) {
        lockStudent(student);
        em.createQuery("delete from WebcamObservation e where e.runId in (select r.id from SharingRun r where r.studentId = :student)")
                .setParameter("student", student).executeUpdate();
        em.createQuery("delete from SharingRun r where r.studentId = :student").setParameter("student", student).executeUpdate();
    }

    @Transactional(readOnly = true)
    public Dashboard dashboard(UUID teacher, UUID sessionId, int page) {
        return dashboard(teacher, sessionId, page, true);
    }
    @Transactional(readOnly = true)
    public Dashboard dashboard(UUID teacher, UUID sessionId, int page, boolean checksOnly) {
        access.requireSessionAccess(teacher, sessionId);
        if (page < 0 || page > 10000) throw new ResponseStatusException(BAD_REQUEST, "Invalid page.");
        Instant now = Instant.now();
        if (!enabled) return new Dashboard(false, now, List.of(), List.of(), false, page);
        var session = sessions.findById(sessionId).orElseThrow();
        var roster = session.getCourseOffering() == null ? List.<CourseEnrollment>of() : enrollments
                .findByCourseOffering_IdAndStatusOrderByStudent_LastNameAscStudent_FirstNameAsc(session.getCourseOffering().getId(), CourseEnrollment.EnrollmentStatus.ACTIVE);
        Map<UUID, SharingRun> latest = new HashMap<>(); Map<UUID, UUID> subjects = new HashMap<>();
        Set<UUID> eligible = new HashSet<>();
        roster.stream().map(CourseEnrollment::getStudent).filter(this::approved).forEach(s -> eligible.add(s.getId()));
        for (var run : runs.findBySessionIdAndExpiresAtAfterOrderByCreatedAtDesc(sessionId, now)) {
            if (!eligible.contains(run.studentId)) continue;
            latest.putIfAbsent(run.studentId, run); subjects.put(run.id, run.studentId);
        }
        Map<UUID, long[]> totals = new HashMap<>();
        if (!subjects.isEmpty()) for (var count : events.summarize(subjects.keySet())) {
            long[] value = totals.computeIfAbsent(subjects.get(count.getRunId()), id -> new long[4]);
            switch (count.getKind()) {
                case "HEAD_TURN", "HEAD_TILT" -> value[0] += count.getCount();
                case "NO_FACE" -> value[1] += count.getCount();
                case "MULTIPLE_FACES" -> value[2] += count.getCount();
                default -> { }
            }
            if (requiresCheck(count.getKind()) && "PENDING".equals(count.getReviewState())) value[3] += count.getCount();
        }
        var students = roster.stream().map(CourseEnrollment::getStudent).filter(this::approved)
                .map(s -> {
                    long[] count = totals.getOrDefault(s.getId(), new long[4]);
                    return new StudentView(s.getId(), s.getFullName(), latest.containsKey(s.getId()) ? view(latest.get(s.getId()), now, open(session, now)) : null,
                        new Summary(count[0], count[1], count[2], count[3]));
                }).toList();
        var rows = subjects.isEmpty() ? List.<WebcamObservation>of() : checksOnly
            ? events.findChecks(subjects.keySet(), PageRequest.of(page, 50))
            : events.findByRunIdInOrderByReceivedAtDescIdDesc(subjects.keySet(), PageRequest.of(page, 50));
        return new Dashboard(true, now, students, rows.stream().map(e -> eventView(e, subjects.get(e.runId))).toList(), rows.size() == 50, page);
    }

    public EventView review(UUID teacher, UUID id, Review body) {
        requireEnabled();
        var event = em.find(WebcamObservation.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (event == null) throw new ResponseStatusException(NOT_FOUND, "Observation no longer available.");
        var run = runs.findById(event.runId).orElseThrow(() -> conflict("Sharing has been withdrawn."));
        access.requireSessionAccess(teacher, run.sessionId);
        if (!run.expiresAt.isAfter(Instant.now())) throw conflict("Observation expired.");
        var student = em.find(Student.class, run.studentId);
        if (student == null || !approved(student)) throw conflict("Student is no longer active.");
        membership(run.studentId, run.sessionId, false);
        if (!requiresCheck(event.kind)) throw conflict("This is an informational event; review is not required.");
        if (body.decision() == null) throw new ResponseStatusException(BAD_REQUEST, "Review decision required.");
        if (!"PENDING".equals(event.reviewState) && !event.reviewState.equals(body.decision().name()))
            throw conflict("Another review already saved a different decision. Refresh the list.");
        if ("PENDING".equals(event.reviewState)) {
            event.reviewState = body.decision().name(); event.reviewedAt = Instant.now(); event.reviewedBy = teacher;
        }
        return eventView(event, run.studentId);
    }

    public List<EventView> reviewBatch(UUID teacher, UUID session, ReviewBatch body) {
        requireEnabled(); access.requireSessionAccess(teacher, session);
        if (body.ids() == null || body.ids().isEmpty() || body.ids().size() > 50 || body.decision() == null)
            throw new ResponseStatusException(BAD_REQUEST, "Select between 1 and 50 reports.");
        // Deterministic locking order avoids deadlock between overlapping teacher selections.
        List<UUID> ids = body.ids().stream().distinct().sorted().toList();
        List<EventView> results = new ArrayList<>();
        for (UUID id : ids) {
            var event = em.find(WebcamObservation.class, id, LockModeType.PESSIMISTIC_WRITE);
            if (event == null) throw new ResponseStatusException(NOT_FOUND, "A selected report is no longer available.");
            var run = runs.findById(event.runId).orElseThrow(() -> conflict("Sharing was withdrawn."));
            if (!run.sessionId.equals(session)) throw new ResponseStatusException(FORBIDDEN, "All selected reports must belong to this session.");
            results.add(review(teacher, id, new Review(body.decision())));
        }
        return results;
    }
    private boolean requiresCheck(String kind) { return "NO_FACE".equals(kind) || "MULTIPLE_FACES".equals(kind); }

    @Scheduled(fixedDelay = 600000, initialDelay = 60000)
    public void purgeExpired() {
        Instant now = Instant.now();
        em.createQuery("delete from WebcamObservation e where e.runId in (select r.id from SharingRun r where r.expiresAt <= :now)")
                .setParameter("now", now).executeUpdate();
        em.createQuery("delete from SharingRun r where r.expiresAt <= :now").setParameter("now", now).executeUpdate();
    }

    private Student lockStudent(UUID id) {
        Student student = em.find(Student.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (student == null) throw new ResponseStatusException(NOT_FOUND, "Student not found.");
        return student;
    }
    private Student eligible(UUID id) {
        var student = lockStudent(id);
        if (!approved(student)) throw new ResponseStatusException(FORBIDDEN, "An approved, active student account is required.");
        return student;
    }
    private boolean approved(Student s) { return "ACTIVE".equals(s.getStatus()) && "APPROVED".equals(s.getApprovalStatus()); }
    private ClassroomSession membership(UUID student, UUID sessionId, boolean requireWindow) {
        var session = sessions.findById(sessionId).orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Session not found."));
        if (session.getCourseOffering() == null || !enrollments.existsByStudent_IdAndCourseOffering_IdAndStatus(student, session.getCourseOffering().getId(), CourseEnrollment.EnrollmentStatus.ACTIVE))
            throw new ResponseStatusException(FORBIDDEN, "Active enrollment in this class is required.");
        if (requireWindow && !open(session, Instant.now())) throw conflict("Sharing opens 15 minutes before class and ends with class.");
        return session;
    }
    private boolean open(ClassroomSession s, Instant now) {
        return Set.of(ClassroomSession.SessionStatus.SCHEDULED, ClassroomSession.SessionStatus.ACTIVE).contains(s.getStatus())
                && !now.isBefore(s.getStartTime().minusSeconds(900)) && now.isBefore(s.getEndTime());
    }
    private SharingRun owned(UUID student, UUID id) {
        var run = em.find(SharingRun.class, id, LockModeType.PESSIMISTIC_WRITE);
        if (run == null) throw new ResponseStatusException(NOT_FOUND, "Sharing run not found.");
        if (!run.studentId.equals(student)) throw new ResponseStatusException(FORBIDDEN, "This sharing run belongs to another student.");
        return run;
    }
    private void requireLive(SharingRun r, Instant now) {
        if (r.stoppedAt != null || !r.expiresAt.isAfter(now) || !r.lastHeartbeat.plusSeconds(LEASE_SECONDS).isAfter(now))
            throw conflict("Sharing stopped or connection expired. Start again explicitly.");
    }
    private RunView view(SharingRun r, Instant now, boolean window) {
        String state = r.stoppedAt != null ? "STOPPED" : !window ? "SESSION_CLOSED" :
                !r.lastHeartbeat.plusSeconds(LEASE_SECONDS).isAfter(now) ? "DISCONNECTED" : r.cameraState;
        return new RunView(r.id, state, r.lastHeartbeat, r.expiresAt, r.sequence);
    }
    private EventView eventView(WebcamObservation e, UUID student) {
        return new EventView(e.id, student, e.kind, e.durationMs, e.receivedAt, e.reviewState, e.reviewedAt);
    }
    private void requireEnabled() { if (!enabled) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Voluntary webcam sharing pilot is disabled."); }
    private ResponseStatusException conflict(String message) { return new ResponseStatusException(CONFLICT, message); }
}
