package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;
import io.github.huijingmen.softeng789.classroommonitoring.dto.*;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;
@RestController
@RequestMapping("/api/auth")
public class StudentSignupController {
    private final StudentSignupProfiles profiles;
    private final StudentContactVerification verification;
    private final SessionAuthService sessions;
    public StudentSignupController(StudentSignupProfiles profiles, StudentContactVerification verification, SessionAuthService sessions) {
        this.profiles=profiles; this.verification=verification; this.sessions=sessions;
    }
    public record ContactRequest(@NotNull AccountLinkPurpose purpose) {}
    public record Confirmation(String token,
            boolean signupPermission, @Size(max=80) String noticeVersion) {
        @Override public String toString() { return "ContactConfirmation[redacted]"; }
    }
    private UUID self(String header) {
        var principal=sessions.resolve(sessions.extractToken(header));
        if (principal==null || !"STUDENT".equals(principal.role())) throw new ResponseStatusException(FORBIDDEN,"Student account required.");
        return principal.id();
    }
    @GetMapping("/signup/profile")
    public StudentProfileResponse profile(@RequestHeader(value="Authorization",required=false) String header, HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return profiles.read(self(header));
    }
    @PutMapping("/signup/profile")
    public StudentProfileResponse update(@RequestHeader(value="Authorization",required=false) String header,
            @Valid @RequestBody UpdateSelfProfileRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return profiles.update(self(header),request);
    }
    @PostMapping("/signup/verification")
    @ResponseStatus(ACCEPTED)
    public void request(@RequestHeader(value="Authorization",required=false) String header, @Valid @RequestBody ContactRequest request) {
        verification.request(self(header),request.purpose());
    }
    @PostMapping("/account-links/confirm-contact")
    @ResponseStatus(NO_CONTENT)
    public void confirm(@Valid @RequestBody Confirmation request) {
        verification.confirm(request.token(),request.signupPermission(),request.noticeVersion());
    }
}