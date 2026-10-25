package io.github.huijingmen.softeng789.classroommonitoring.livevideo;

import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/live-video")
public class LiveVideoController {
    private final LiveVideoService service;
    private final SessionAuthService auth;
    public LiveVideoController(LiveVideoService service, SessionAuthService auth) { this.service = service; this.auth = auth; }
    @ModelAttribute void noCache(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @GetMapping("/students/{student}/sessions")
    public LiveVideoService.Workspace workspace(@PathVariable UUID student, @RequestHeader(value="Authorization", required=false) String token) {
        auth.requireStudentSelf(token, student); return service.workspace(student);
    }
    @PostMapping("/students/{student}/sessions/{session}/streams")
    public LiveVideoService.View start(@PathVariable UUID student, @PathVariable UUID session, @RequestHeader(value="Authorization", required=false) String token, @Valid @RequestBody LiveVideoService.Start body) {
        auth.requireStudentSelf(token, student); return service.start(student, session, body);
    }
    @PostMapping("/students/{student}/streams/{stream}/pulse")
    public LiveVideoService.View pulse(@PathVariable UUID student, @PathVariable UUID stream, @RequestHeader(value="Authorization", required=false) String token, @Valid @RequestBody LiveVideoService.Signal body) {
        auth.requireStudentSelf(token, student); return service.pulse(student, stream, body);
    }
    @DeleteMapping("/students/{student}/streams/{stream}")
    public void stop(@PathVariable UUID student, @PathVariable UUID stream, @RequestHeader(value="Authorization", required=false) String token) {
        auth.requireStudentSelf(token, student); service.stop(student, stream);
    }
    @GetMapping("/sessions/{session}/streams")
    public LiveVideoService.Board board(@PathVariable UUID session, @RequestHeader(value="Authorization", required=false) String token) { return service.board(auth.requireTeacher(token), session); }
    @PostMapping("/sessions/{session}/streams/{stream}/viewer")
    public LiveVideoService.View watch(@PathVariable UUID session, @PathVariable UUID stream, @RequestHeader(value="Authorization", required=false) String token, @Valid @RequestBody LiveVideoService.Signal body) {
        return service.watch(auth.requireTeacher(token), session, stream, body);
    }
    @DeleteMapping("/sessions/{session}/streams/{stream}/viewer/{viewer}")
    public void leave(@PathVariable UUID session, @PathVariable UUID stream, @PathVariable UUID viewer, @RequestHeader(value="Authorization", required=false) String token) {
        service.leave(auth.requireTeacher(token), session, stream, viewer);
    }
}
