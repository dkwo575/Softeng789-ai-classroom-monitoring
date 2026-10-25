package io.github.huijingmen.softeng789.classroommonitoring.livevideo;

import io.github.huijingmen.softeng789.classroommonitoring.entity.*;
import io.github.huijingmen.softeng789.classroommonitoring.repository.*;
import io.github.huijingmen.softeng789.classroommonitoring.service.StaffAccessService;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

/** Single-server, four-stream pilot. Only short-lived signaling is held in memory, never media. */
@Service
@Transactional(readOnly = true)
public class LiveVideoService {
    public static final String NOTICE = "live-video-adult-pilot-v1";
    private final StudentRepository students;
    private final TeacherRepository teachers;
    private final ClassroomSessionRepository sessions;
    private final CourseEnrollmentRepository enrollments;
    private final StaffAccessService access;
    private final boolean enabled;
    private final Map<UUID, Stream> streams = new HashMap<>();
    private Clock clock = Clock.systemUTC();
    private static final int LEASE = 20;
    private static class Stream {
        UUID id, student, session, viewer, teacher;
        String name, viewerName, offer, answer;
        Instant expires, viewerExpires;
        void clearViewer() { viewer = null; teacher = null; viewerName = null; offer = null; answer = null; viewerExpires = null; }
    }
    public LiveVideoService(StudentRepository students, TeacherRepository teachers, ClassroomSessionRepository sessions,
            CourseEnrollmentRepository enrollments, StaffAccessService access, @Value("${live-video.enabled:false}") boolean enabled) {
        this.students = students; this.teachers = teachers; this.sessions = sessions; this.enrollments = enrollments; this.access = access; this.enabled = enabled;
    }
    public record Start(@NotNull UUID id, @AssertTrue boolean adultConfirmed, @AssertTrue boolean consent, @NotNull String noticeVersion) {}
    public record Signal(UUID viewer, @Size(max = 32000) String sdp) {}
    public record View(UUID id, UUID studentId, String name, UUID viewer, String viewerName, String sdp) {}
    public record Option(UUID id, String course, Instant startTime, boolean open) {}
    public record Workspace(boolean enabled, String noticeVersion, List<Option> sessions) {}
    public record Board(boolean enabled, List<View> streams) {}

    public Workspace workspace(UUID student) {
        approved(student); Instant now = clock.instant();
        return new Workspace(enabled, NOTICE, enabled ? sessions.findCheckInSessions(student, now.minusSeconds(86400), now.plusSeconds(86400))
            .stream().map(s -> new Option(s.getId(), s.getCourse(), s.getStartTime(), open(s))).toList() : List.of());
    }
    public synchronized View start(UUID student, UUID session, Start body) {
        requireEnabled(); prune(); Student person = eligible(student, session);
        if (body.id() == null || !body.adultConfirmed() || !body.consent() || !NOTICE.equals(body.noticeVersion()))
            throw new ResponseStatusException(BAD_REQUEST, "Current adult video-sharing consent is required.");
        Stream previous = streams.get(body.id());
        if (previous != null) {
            if (!previous.student.equals(student) || !previous.session.equals(session)) throw denied();
            return view(previous, previous.answer);
        }
        if (streams.values().stream().anyMatch(s -> s.student.equals(student))) throw conflict("Video is already shared in another tab. Stop it first or wait 20 seconds.");
        if (streams.size() >= 100 || streams.values().stream().filter(s -> s.session.equals(session)).count() >= 4)
            throw new ResponseStatusException(TOO_MANY_REQUESTS, "This pilot supports four students per class. Try again after a stream stops.");
        Stream stream = new Stream(); stream.id = body.id(); stream.student = student; stream.session = session;
        stream.name = person.getFullName(); stream.expires = clock.instant().plusSeconds(LEASE); streams.put(stream.id, stream);
        return view(stream, null);
    }
    public synchronized View pulse(UUID student, UUID id, Signal body) {
        requireEnabled(); prune(); Stream s = owned(student, id); eligible(student, s.session);
        // A teacher may have released/replaced the viewer while an offer was being gathered.
        if (body.sdp() != null && Objects.equals(body.viewer(), s.viewer) && s.viewer != null) {
            validateSdp(body.sdp());
            if (s.offer != null && !s.offer.equals(body.sdp())) throw conflict("Restart video to renegotiate.");
            s.offer = body.sdp();
        }
        if (s.teacher != null) {
            try { access.requireSessionAccess(s.teacher, s.session); }
            catch (ResponseStatusException revoked) { s.clearViewer(); }
        }
        s.expires = clock.instant().plusSeconds(LEASE); return view(s, s.answer);
    }
    public synchronized void stop(UUID student, UUID id) {
        Stream s = streams.get(id); if (s == null) return;
        if (!s.student.equals(student)) throw denied(); streams.remove(id);
    }
    public synchronized Board board(UUID teacher, UUID session) {
        access.requireSessionAccess(teacher, session); prune();
        if (!enabled) return new Board(false, List.of());
        List<View> result = new ArrayList<>();
        for (Stream s : new ArrayList<>(streams.values())) if (s.session.equals(session)) {
            try { eligible(s.student, session); result.add(view(s, null)); }
            catch (ResponseStatusException revoked) { streams.remove(s.id); }
        }
        result.sort(Comparator.comparing(View::name)); return new Board(true, result);
    }
    public synchronized View watch(UUID teacher, UUID session, UUID id, Signal body) {
        requireEnabled(); access.requireSessionAccess(teacher, session); prune();
        Stream s = streams.get(id); if (s == null) throw conflict("Student stopped sharing or connection expired.");
        if (!s.session.equals(session)) throw denied(); eligible(s.student, session);
        if (body.viewer() == null) throw new ResponseStatusException(BAD_REQUEST, "Viewer id required.");
        if (s.viewer != null && (!s.viewer.equals(body.viewer()) || !s.teacher.equals(teacher))) throw conflict("Another teacher window is viewing this stream.");
        if (s.viewer == null) {
            if (body.sdp() != null) throw conflict("Start viewing before answering.");
            s.viewer = body.viewer(); s.teacher = teacher; s.viewerName = teachers.findById(teacher).orElseThrow().getName();
        }
        if (body.sdp() != null) {
            validateSdp(body.sdp());
            if (s.offer == null) throw conflict("Wait for the student offer.");
            if (s.answer != null && !s.answer.equals(body.sdp())) throw conflict("Restart viewing to renegotiate.");
            s.answer = body.sdp();
        }
        s.viewerExpires = clock.instant().plusSeconds(LEASE); return view(s, s.offer);
    }
    public synchronized void leave(UUID teacher, UUID session, UUID id, UUID viewer) {
        access.requireSessionAccess(teacher, session); Stream s = streams.get(id); if (s == null) return;
        if (!s.session.equals(session)) throw denied();
        if (teacher.equals(s.teacher) && viewer.equals(s.viewer)) s.clearViewer();
    }
    @Scheduled(fixedDelay = 5000)
    public synchronized void prune() {
        Instant now = clock.instant(); streams.values().removeIf(s -> !s.expires.isAfter(now));
        streams.values().forEach(s -> { if (s.viewerExpires != null && !s.viewerExpires.isAfter(now)) s.clearViewer(); });
    }
    private View view(Stream s, String sdp) { return new View(s.id, s.student, s.name, s.viewer, s.viewerName, sdp); }
    private Student approved(UUID student) {
        Student s = students.findById(student).orElseThrow(() -> denied());
        if (!"ACTIVE".equals(s.getStatus()) || !"APPROVED".equals(s.getApprovalStatus())) throw denied(); return s;
    }
    private Student eligible(UUID student, UUID session) {
        Student person = approved(student); ClassroomSession s = sessions.findById(session).orElseThrow(() -> denied());
        if (s.getCourseOffering() == null || !enrollments.existsByStudent_IdAndCourseOffering_IdAndStatus(student, s.getCourseOffering().getId(), CourseEnrollment.EnrollmentStatus.ACTIVE)) throw denied();
        if (!open(s)) throw conflict("Video sharing opens 15 minutes before class and ends with class."); return person;
    }
    private boolean open(ClassroomSession s) {
        Instant now = clock.instant(); return Set.of(ClassroomSession.SessionStatus.SCHEDULED, ClassroomSession.SessionStatus.ACTIVE).contains(s.getStatus())
            && !now.isBefore(s.getStartTime().minusSeconds(900)) && now.isBefore(s.getEndTime());
    }
    private Stream owned(UUID student, UUID id) { Stream s = streams.get(id); if (s == null) throw conflict("Video sharing expired. Start again explicitly."); if (!s.student.equals(student)) throw denied(); return s; }
    private void validateSdp(String sdp) {
        if (sdp.length() > 32000 || !sdp.startsWith("v=0") || !sdp.contains("m=video ") || sdp.contains("m=audio ") || sdp.contains("m=application "))
            throw new ResponseStatusException(BAD_REQUEST, "Only bounded video-only signaling is supported.");
    }
    private void requireEnabled() { if (!enabled) throw new ResponseStatusException(SERVICE_UNAVAILABLE, "Live video pilot is disabled."); }
    private ResponseStatusException denied() { return new ResponseStatusException(FORBIDDEN, "This video stream is not available to your account."); }
    private ResponseStatusException conflict(String message) { return new ResponseStatusException(CONFLICT, message); }
}
