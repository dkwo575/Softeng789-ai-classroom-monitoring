package io.github.huijingmen.softeng789.classroommonitoring.observation;

import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/webcam")
public class ObservationController {
    private final ObservationService service;
    private final SessionAuthService auth;
    public ObservationController(ObservationService service, SessionAuthService auth) { this.service = service; this.auth = auth; }
    @ModelAttribute void noCache(jakarta.servlet.http.HttpServletResponse response) { response.setHeader("Cache-Control", "no-store"); }
    @GetMapping("/students/{student}/sessions")
    public ObservationService.Workspace workspace(@PathVariable UUID student, @RequestHeader(value = "Authorization", required = false) String token) {
        auth.requireStudentSelf(token, student); return service.workspace(student);
    }
    @PostMapping("/students/{student}/sessions/{session}/runs")
    public ObservationService.RunView start(@PathVariable UUID student, @PathVariable UUID session,
            @RequestHeader(value = "Authorization", required = false) String token, @Valid @RequestBody ObservationService.Start body) {
        auth.requireStudentSelf(token, student); return service.start(student, session, body);
    }
    @PostMapping("/students/{student}/runs/{run}/pulse")
    public ObservationService.RunView pulse(@PathVariable UUID student, @PathVariable UUID run,
            @RequestHeader(value = "Authorization", required = false) String token, @Valid @RequestBody ObservationService.Pulse body) {
        auth.requireStudentSelf(token, student); return service.pulse(student, run, body);
    }
    @PostMapping("/students/{student}/runs/{run}/stop")
    public void stop(@PathVariable UUID student, @PathVariable UUID run, @RequestHeader(value = "Authorization", required = false) String token) {
        auth.requireStudentSelf(token, student); service.stop(student, run);
    }
    @DeleteMapping("/students/{student}/sharing")
    public void withdraw(@PathVariable UUID student, @RequestHeader(value = "Authorization", required = false) String token) {
        auth.requireStudentSelf(token, student); service.withdraw(student);
    }
    @GetMapping("/sessions/{session}/observations")
    public ObservationService.Dashboard dashboard(@PathVariable UUID session, @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "true") boolean checksOnly,
            @RequestHeader(value = "Authorization", required = false) String token) {
        return service.dashboard(auth.requireTeacher(token), session, page, checksOnly);
    }
    @PostMapping("/sessions/{session}/observations/review")
    public java.util.List<ObservationService.EventView> reviewBatch(@PathVariable UUID session,
            @RequestHeader(value = "Authorization", required = false) String token,
            @Valid @RequestBody ObservationService.ReviewBatch body) {
        return service.reviewBatch(auth.requireTeacher(token), session, body);
    }
    @PostMapping("/observations/{id}/review")
    public ObservationService.EventView review(@PathVariable UUID id, @RequestHeader(value = "Authorization", required = false) String token,
            @Valid @RequestBody ObservationService.Review body) {
        return service.review(auth.requireTeacher(token), id, body);
    }
}
