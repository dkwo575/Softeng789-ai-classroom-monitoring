package io.github.huijingmen.softeng789.classroommonitoring.controller;

import io.github.huijingmen.softeng789.classroommonitoring.dto.AuthResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.LoginRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.RegisterStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.RegisterTeacherRequest;
import io.github.huijingmen.softeng789.classroommonitoring.service.AuthService;
import io.github.huijingmen.softeng789.classroommonitoring.service.LoginAttemptService;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import io.github.huijingmen.softeng789.classroommonitoring.auth.BrowserSessionCookies;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import static org.springframework.http.HttpStatus.CREATED;
import static org.springframework.http.HttpStatus.NO_CONTENT;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;
    private final SessionAuthService sessionAuthService;
    private final LoginAttemptService loginAttemptService;
    private final BrowserSessionCookies cookies;
    private final CookieCsrfTokenRepository csrfTokens;

    public AuthController(
            AuthService authService,
            SessionAuthService sessionAuthService,
            LoginAttemptService loginAttemptService,
            BrowserSessionCookies cookies,
            CookieCsrfTokenRepository csrfTokens
    ) {
        this.authService = authService;
        this.sessionAuthService = sessionAuthService;
        this.loginAttemptService = loginAttemptService;
        this.cookies = cookies;
        this.csrfTokens = csrfTokens;
    }

    public record CsrfResponse(String headerName, String token) { }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getHeaderName(), token.getToken());
    }

    @PostMapping(
            path = "/register/student",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    @ResponseStatus(CREATED)
    public AuthResponse registerStudent(
            @Valid @RequestPart("registration") RegisterStudentRequest request,
            @RequestPart(value = "metadata", required = false) String metadata,
            @RequestPart(value = "images", required = false) List<MultipartFile> images,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        return establish(authService.registerStudent(request, metadata, images), servletRequest, servletResponse);
    }

    @PostMapping("/register/teacher")
    @ResponseStatus(CREATED)
    public AuthResponse registerTeacher(@Valid @RequestBody RegisterTeacherRequest request,
            HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        return establish(authService.registerTeacher(request), servletRequest, servletResponse);
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        var reservation = loginAttemptService.beginAttempt(authService.loginBudgetIdentity(request.email()));
        AuthResponse response = authService.login(request);
        var current = sessionAuthService.resolve(cookies.read(servletRequest));
        if (current != null && "KIOSK".equals(current.role())
                && !"TEACHER".equals(response.role()) && !"ADMIN".equals(response.role())) {
            sessionAuthService.logout(response.token());
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.FORBIDDEN, "A staff member must exit kiosk mode.");
        }
        loginAttemptService.recordSuccess(reservation);
        return establish(response, servletRequest, servletResponse);
    }

    /** A kiosk explicitly advertises a null token; its cookie remains the sole credential. */
    private record KioskIdentity(String token, String role, java.util.UUID id, String name, String email, String approvalStatus) {
        @Override public String toString() { return "KioskIdentity[role=KIOSK]"; }
    }

    @GetMapping("/me")
    public Object me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        String token = sessionAuthService.extractToken(authorization);
        AuthResponse kiosk = sessionAuthService.kioskIdentity(token);
        return kiosk == null ? authService.me(token) : new KioskIdentity(null, kiosk.role(), kiosk.id(), kiosk.name(), null, kiosk.approvalStatus());
    }

    @PostMapping("/logout")
    @ResponseStatus(NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        sessionAuthService.logout(cookies.read(request));
        cookies.clear(response);
        csrfTokens.saveToken(null, request, response);
    }

    private AuthResponse establish(AuthResponse login, HttpServletRequest request, HttpServletResponse response) {
        sessionAuthService.logout(cookies.read(request));
        cookies.issue(response, login.token());
        csrfTokens.saveToken(null, request, response);
        return login;
    }
}
