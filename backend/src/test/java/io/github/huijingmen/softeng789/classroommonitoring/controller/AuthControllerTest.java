package io.github.huijingmen.softeng789.classroommonitoring.controller;

import io.github.huijingmen.softeng789.classroommonitoring.dto.AuthResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.LoginRequest;
import io.github.huijingmen.softeng789.classroommonitoring.service.AuthService;
import io.github.huijingmen.softeng789.classroommonitoring.service.LoginAttemptService;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuthControllerTest {
    private AuthService authService;
    private LoginAttemptService loginAttemptService;
    private AuthController authController;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        when(authService.loginBudgetIdentity(any())).thenAnswer(call -> call.getArgument(0));
        loginAttemptService = mock(LoginAttemptService.class);
        authController = new AuthController(
                authService,
                mock(SessionAuthService.class),
                loginAttemptService,
                new io.github.huijingmen.softeng789.classroommonitoring.auth.BrowserSessionCookies(new org.springframework.mock.env.MockEnvironment()),
                new org.springframework.security.web.csrf.CookieCsrfTokenRepository()
        );
        mockMvc = MockMvcBuilders
                .standaloneSetup(authController)
                .build();
    }

    @Test
    void acceptsBrowserMultipartContentTypeWithBoundaryAndCharset() throws Exception {
        UUID classId = UUID.randomUUID();
        UUID studentId = UUID.randomUUID();
        String registrationJson = """
                {
                  "studentNumber": "123456789",
                  "universityEmail": "ana.ngata@aucklanduni.ac.nz",
                  "fullName": "Ana Ngata",
                  "course": "SOFTENG 789",
                  "classOfferingIds": ["%s"],
                  "password": "correct-horse-battery",
                  "consentGiven": true,
                  "level": "LEVEL_1",
                  "emailProof": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ"
                }
                """.formatted(classId);

        MockMultipartFile registration = new MockMultipartFile(
                "registration",
                "registration.json",
                MediaType.APPLICATION_JSON_VALUE,
                registrationJson.getBytes(StandardCharsets.UTF_8)
        );
        MockMultipartFile metadata = new MockMultipartFile(
                "metadata",
                "",
                MediaType.TEXT_PLAIN_VALUE,
                "[]".getBytes(StandardCharsets.UTF_8)
        );
        MockMultipartFile image = new MockMultipartFile(
                "images",
                "front.jpg",
                MediaType.IMAGE_JPEG_VALUE,
                new byte[] {1, 2, 3}
        );
        AuthResponse response = new AuthResponse(
                "token",
                SessionAuthService.ROLE_STUDENT,
                studentId,
                "Ana Ngata",
                "ana.ngata@aucklanduni.ac.nz",
                "PENDING"
        );
        when(authService.registerStudent(any(), eq("[]"), anyList())).thenReturn(response);

        mockMvc.perform(multipart("/api/auth/register/student")
                        .file(registration)
                        .file(metadata)
                        .file(image)
                        .contentType(MediaType.parseMediaType(
                                "multipart/form-data;boundary=----WebKitFormBoundaryhUPv36xNcNwdpNVC;charset=UTF-8"
                        )))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.token").doesNotExist())
                .andExpect(jsonPath("$.approvalStatus").value("PENDING"));
    }

    @Test
    void manualRegistrationNeedsNoBiometricConsentOrPhotoParts() throws Exception {
        String registrationJson = """
                {"studentNumber":"manual-test", "universityEmail":"manual@test.test",
                 "fullName":"Manual Student", "course":"TEST", "classOfferingIds":["%s"],
                 "password":"correct-horse-battery", "consentGiven":false, "level":"LEVEL_1"}
                """.formatted(UUID.randomUUID());
        when(authService.registerStudent(any(), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull()))
                .thenReturn(new AuthResponse("test-session", "STUDENT", UUID.randomUUID(),
                        "Manual Student", "manual@test.test", "PENDING"));
        mockMvc.perform(multipart("/api/auth/register/student").file(new MockMultipartFile(
                        "registration", "registration.json", MediaType.APPLICATION_JSON_VALUE,
                        registrationJson.getBytes(StandardCharsets.UTF_8))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.token").doesNotExist())
                .andExpect(jsonPath("$.approvalStatus").value("PENDING"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie().httpOnly("classlens-session", true));
    }

    @Test
    void successfulLoginClearsFailedAttemptState() {
        LoginRequest request = new LoginRequest("student@example.com", "correct-password");
        AuthResponse response = new AuthResponse(
                "token",
                SessionAuthService.ROLE_STUDENT,
                UUID.randomUUID(),
                "Student",
                request.email(),
                "APPROVED"
        );
        when(authService.login(request)).thenReturn(response);
        var reservation = new io.github.huijingmen.softeng789.classroommonitoring.auth.LoginAttemptStore.Reservation(
                "digest", UUID.randomUUID(), 1L);
        when(loginAttemptService.beginAttempt(request.email())).thenReturn(reservation);

        authController.login(request, new org.springframework.mock.web.MockHttpServletRequest(), new org.springframework.mock.web.MockHttpServletResponse());

        var order = org.mockito.Mockito.inOrder(loginAttemptService, authService);
        order.verify(loginAttemptService).beginAttempt(request.email());
        order.verify(authService).login(request);
        order.verify(loginAttemptService).recordSuccess(reservation);
    }

    @Test
    void rejectedCredentialsAreRecordedAsAFailedAttempt() {
        LoginRequest request = new LoginRequest("student@example.com", "wrong-password");
        when(authService.login(request))
                .thenThrow(new ResponseStatusException(UNAUTHORIZED, "Incorrect email or password."));

        assertThatThrownBy(() -> authController.login(request, new org.springframework.mock.web.MockHttpServletRequest(), new org.springframework.mock.web.MockHttpServletResponse()))
                .isInstanceOf(ResponseStatusException.class);

        verify(loginAttemptService).beginAttempt(request.email());
        verify(loginAttemptService, never()).recordSuccess(any());
    }

    @Test
    void blockedOrUnavailableAdmissionNeverReachesPasswordVerification() {
        LoginRequest request = new LoginRequest("student@example.com", "wrong-password");
        for (var status : java.util.List.of(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS,
                org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE)) {
            org.mockito.Mockito.doThrow(new ResponseStatusException(status))
                    .when(loginAttemptService).beginAttempt(request.email());
            assertThatThrownBy(() -> authController.login(request,
                    new org.springframework.mock.web.MockHttpServletRequest(),
                    new org.springframework.mock.web.MockHttpServletResponse()))
                    .isInstanceOf(ResponseStatusException.class);
        }
        verify(authService, never()).login(any());
    }
}
