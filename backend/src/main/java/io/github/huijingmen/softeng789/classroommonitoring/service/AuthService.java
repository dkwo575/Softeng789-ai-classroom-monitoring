package io.github.huijingmen.softeng789.classroommonitoring.service;

import io.github.huijingmen.softeng789.classroommonitoring.dto.AuthResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.LoginRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.RegisterStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.RegisterTeacherRequest;
import io.github.huijingmen.softeng789.classroommonitoring.entity.CourseEnrollment;
import io.github.huijingmen.softeng789.classroommonitoring.entity.CourseOffering;
import io.github.huijingmen.softeng789.classroommonitoring.entity.Student;
import io.github.huijingmen.softeng789.classroommonitoring.entity.Teacher;
import io.github.huijingmen.softeng789.classroommonitoring.repository.CourseEnrollmentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.CourseOfferingRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.StudentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.TeacherRepository;
import io.github.huijingmen.softeng789.classroommonitoring.vision.RegistrationFaceService;
import io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.AccountLinkProofs;
import io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.AccountLinkPurpose;
import io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.AccountPasswordPolicy;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.FORBIDDEN;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;

/**
 * Registration, password verification and current profile. Durable session lifecycle and domain
 * authorization gates live in {@link SessionAuthService}; the HTTP layer transports the credential
 * exclusively through a protected cookie, not through public JSON or a browser Bearer header.
 */
@Service
public class AuthService {
    private static final String STATUS_DEACTIVATED = "DEACTIVATED";
    private static final String STATUS_WITHDRAWN = "WITHDRAWN";

    private final StudentRepository studentRepository;
    private final TeacherRepository teacherRepository;
    private final CourseLookupService courseLookupService;
    private final CourseOfferingRepository courseOfferingRepository;
    private final CourseEnrollmentRepository courseEnrollmentRepository;
    private final FaceRegistrationVerifier faceRegistrationVerifier;
    private final FaceEnrollmentService faceEnrollmentService;
    private final RegistrationFaceService registrationFaces;
    private final PasswordEncoder passwordEncoder;
    private final SessionAuthService sessionAuthService;
    private final AccountLinkProofs accountLinks;
    private final io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.StudentSignupProfiles signupProfiles;

    public AuthService(
            StudentRepository studentRepository,
            TeacherRepository teacherRepository,
            CourseLookupService courseLookupService,
            CourseOfferingRepository courseOfferingRepository,
            CourseEnrollmentRepository courseEnrollmentRepository,
            FaceRegistrationVerifier faceRegistrationVerifier,
            FaceEnrollmentService faceEnrollmentService,
            SessionAuthService sessionAuthService,
            PasswordEncoder passwordEncoder,
            RegistrationFaceService registrationFaces,
            AccountLinkProofs accountLinks,
            io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.StudentSignupProfiles signupProfiles
    ) {
        this.registrationFaces = registrationFaces;
        this.studentRepository = studentRepository;
        this.teacherRepository = teacherRepository;
        this.courseLookupService = courseLookupService;
        this.courseOfferingRepository = courseOfferingRepository;
        this.courseEnrollmentRepository = courseEnrollmentRepository;
        this.faceRegistrationVerifier = faceRegistrationVerifier;
        this.faceEnrollmentService = faceEnrollmentService;
        this.sessionAuthService = sessionAuthService;
        this.passwordEncoder = passwordEncoder;
        this.accountLinks = accountLinks;
        this.signupProfiles = signupProfiles;
    }

    @Transactional
    public AuthResponse registerStudent(
            RegisterStudentRequest request,
            String captureMetadata,
            List<MultipartFile> captureImages
    ) {
        AccountPasswordPolicy.require(request.password());
        String studentNumber = request.studentNumber().trim();
        signupProfiles.validateRegistration(request.profile(), request.attendanceMode(), request.consentGiven());
        String email = request.universityEmail().trim().toLowerCase(java.util.Locale.ROOT);
        // New students no longer need mailbox proof. Keep cross-role identity conflicts explicit
        // instead of relying on the email-link target resolver to reject them before registration.
        if (teacherRepository.findByEmailIgnoreCase(email).isPresent()) {
            throw new ResponseStatusException(CONFLICT,
                    "This email belongs to a staff account. Use staff activation or contact an administrator.");
        }
        List<CourseOffering> selectedClasses = resolveSelectedClasses(request.classOfferingIds());
        String courseCode = courseLookupService.normaliseCourseCode(selectedClasses.get(0).getCourse().getCode());
        String[] names = splitFullName(request.fullName().trim());

        Optional<Student> existingByNumber = studentRepository.findByStudentNumberIgnoreCase(studentNumber);
        if (existingByNumber.isPresent()) {
            Student existing = existingByNumber.get();
            studentNumber = existing.getStudentNumber();
            if (existing.getPasswordHash() != null) {
                throw new ResponseStatusException(CONFLICT, "That student ID is already registered.");
            }
            // A teacher pre-provisioned this student (e.g. via a roster import) before they ever
            // signed up themselves — claim that record instead of bouncing them with a 409.
            // The email must match what the teacher already recorded: knowing a student number
            // alone (guessable/sequential) must not be enough to hijack someone else's account.
            if (!existing.getUniversityEmail().equalsIgnoreCase(email)) {
                throw new ResponseStatusException(CONFLICT,
                        "That student ID is already registered under a different email. "
                                + "Contact your teacher if this is a mistake.");
            }
            // Removing the first-time email step must not permit claiming an already-approved
            // student's private records with only their discoverable student number and email.
            if (request.emailProof() == null || request.emailProof().isBlank()) {
                throw new ResponseStatusException(FORBIDDEN,
                        "That student account already exists. Contact an administrator to activate it.");
            }
            accountLinks.checkRegistration(request.emailProof(), AccountLinkPurpose.STUDENT_REGISTRATION,
                    email, existing.getId(), SessionAuthService.ROLE_STUDENT);
            // Legacy clients keep their provider adapter. Explicit attendance-mode requests use
            // the real CV pipeline; inference suspends this transaction before any account writes.
            FaceRegistrationVerifier.VerifiedCaptureSet verifiedCaptures =
                    request.attendanceMode() == null && request.consentGiven() ? faceRegistrationVerifier.verify(studentNumber, captureMetadata, captureImages) : null;
            var prepared = request.attendanceMode() == null ? null : registrationFaces.prepare(request, captureMetadata, captureImages);
            if (!"ACTIVE".equals(existing.getStatus())) throw new ResponseStatusException(CONFLICT, "Contact an administrator to reactivate this account.");
            // Omitting the new attendanceMode field must not bypass account review.
            existing.setApprovalStatus("PENDING");
            accountLinks.consumeRegistration(request.emailProof(), AccountLinkPurpose.STUDENT_REGISTRATION,
                    email, existing.getId(), SessionAuthService.ROLE_STUDENT);
            existing.setUniversityEmail(email);
            existing.setFirstName(names[0]);
            existing.setLastName(names[1]);
            existing.setConsentGiven(request.consentGiven());
            existing.setLevel(request.level());
            existing.setPasswordHash(passwordEncoder.encode(request.password()));
            // existing.version is still whatever was loaded above — if another request claimed
            // this same record in between, Hibernate's version check fails this save with an
            // optimistic-locking exception (caught by ApiExceptionHandler) instead of one claim
            // silently overwriting the other's password.
            // Flush before the enrollment consent path locks/refreshes the student row.
            Student saved = studentRepository.saveAndFlush(existing);
            signupProfiles.register(saved, request.profile(), true, false);
            enrolInSelectedClasses(saved, selectedClasses);
            studentRepository.flush();
            if (verifiedCaptures != null) faceEnrollmentService.persistVerifiedCaptures(saved.getId(), verifiedCaptures);
            if (prepared != null) registrationFaces.save(saved.getId(), prepared);
            return sessionAuthService.issueToken(SessionAuthService.ROLE_STUDENT, saved.getId(), saved.getFullName(),
                    saved.getUniversityEmail(), saved.getApprovalStatus());
        }

        if (studentRepository.findByUniversityEmailIgnoreCase(email).isPresent()) {
            throw new ResponseStatusException(CONFLICT, "That university email is already registered.");
        }

        if (request.emailProof() != null && !request.emailProof().isBlank())
            accountLinks.consumeRegistration(request.emailProof(), AccountLinkPurpose.STUDENT_REGISTRATION,
                    email, null, SessionAuthService.ROLE_STUDENT);
        FaceRegistrationVerifier.VerifiedCaptureSet verifiedCaptures =
                request.attendanceMode() == null && request.consentGiven() ? faceRegistrationVerifier.verify(studentNumber, captureMetadata, captureImages) : null;

        var prepared = request.attendanceMode() == null ? null : registrationFaces.prepare(request, captureMetadata, captureImages);
        Student student = new Student();
        student.setStudentNumber(studentNumber);
        student.setUniversityEmail(email);
        student.setFirstName(names[0]);
        student.setLastName(names[1]);
        student.setCourse(courseCode);
        student.setSeat("Unassigned");
        // Self-registration never asks for a programme — "Unassigned" reads like a real (if odd)
        // programme name here, unlike a seat assignment where the word actually fits. Left blank;
        // the frontend shows "Not provided" for an empty value instead of the raw empty string.
        student.setProgramme("");
        student.setConsentGiven(request.consentGiven());
        student.setLevel(request.level());
        student.setPasswordHash(passwordEncoder.encode(request.password()));
        // New registrations, including explicit-mode claims above, require Admin review.
        student.setApprovalStatus("PENDING");
        student = studentRepository.saveAndFlush(student);
        signupProfiles.register(student, request.profile(), request.emailProof() != null && !request.emailProof().isBlank(), true);
        enrolInSelectedClasses(student, selectedClasses);

        studentRepository.flush();
        // Enrollment material joins the account/class transaction. Pending CV material remains
        // separate from active profiles until Admin approval; any storage failure rolls back all.
        if (verifiedCaptures != null) faceEnrollmentService.persistVerifiedCaptures(student.getId(), verifiedCaptures);
        if (prepared != null) registrationFaces.save(student.getId(), prepared);

        return sessionAuthService.issueToken(SessionAuthService.ROLE_STUDENT, student.getId(), student.getFullName(),
                student.getUniversityEmail(), student.getApprovalStatus());
    }

    private List<CourseOffering> resolveSelectedClasses(List<UUID> classOfferingIds) {
        Set<UUID> requestedIds = Set.copyOf(classOfferingIds);
        List<CourseOffering> selected = courseOfferingRepository.findAllById(requestedIds);
        boolean allAvailable = selected.size() == requestedIds.size()
                && selected.stream().allMatch(offering -> "ACTIVE".equals(offering.getStatus()));
        if (!allAvailable) {
            throw new ResponseStatusException(BAD_REQUEST,
                    "One or more selected classes are no longer open for registration. Refresh and try again.");
        }
        return selected;
    }

    // Registration only accepts real, active Admin-provisioned classes. They are resolved and
    // validated as a complete set above; a stale or archived selection fails the submission
    // instead of silently creating a student whose requested class is missing. Enrolments start
    // PENDING until Admin approves the registration (see StudentService.approveStudent).
    private void enrolInSelectedClasses(Student student, List<CourseOffering> selectedClasses) {
        for (CourseOffering offering : selectedClasses) {
            if (courseEnrollmentRepository.findByStudent_IdAndCourseOffering_Id(
                    student.getId(), offering.getId()).isPresent()) {
                continue;
            }
            CourseEnrollment enrollment = new CourseEnrollment();
            enrollment.setStudent(student);
            enrollment.setCourseOffering(offering);
            enrollment.setStatus(CourseEnrollment.EnrollmentStatus.PENDING);
            courseEnrollmentRepository.save(enrollment);
        }
    }

    @Transactional
    public AuthResponse registerTeacher(RegisterTeacherRequest request) {
        AccountPasswordPolicy.require(request.password());
        String staffNumber = request.staffNumber().trim();
        String email = request.email().trim();

        // Shared by every session left without a named teacher — claiming it would hand the
        // claimant full teacher access under a well-known, discoverable identity.
        if (email.equalsIgnoreCase(ClassroomSessionService.DEFAULT_TEACHER_EMAIL)) {
            throw new ResponseStatusException(CONFLICT, "That email is reserved and cannot be registered.");
        }

        Optional<Teacher> existingByEmail = teacherRepository.findByEmailIgnoreCase(email);
        if (existingByEmail.isPresent()) {
            Teacher existing = existingByEmail.get();
            if (existing.getPasswordHash() != null) {
                throw new ResponseStatusException(CONFLICT, "That email is already registered.");
            }
            if (!SessionAuthService.ROLE_TEACHER.equals(existing.getRole())
                    && !SessionAuthService.ROLE_ADMIN.equals(existing.getRole())) {
                throw new ResponseStatusException(FORBIDDEN,
                        "That staff role is not eligible for activation.");
            }
            if (!existing.getStaffNumber().equalsIgnoreCase(staffNumber)) {
                throw new ResponseStatusException(FORBIDDEN,
                        "The staff ID does not match the account invitation.");
            }
            if (STATUS_DEACTIVATED.equals(existing.getStatus())) {
                throw new ResponseStatusException(FORBIDDEN,
                        "This account has been deactivated. Contact an administrator.");
            }

            accountLinks.consumeRegistration(request.emailProof(), AccountLinkPurpose.STAFF_ACTIVATION,
                    email, existing.getId(), existing.getRole());

            // Claim the exact passwordless staff record only after mailbox proof. Neither the
            // role nor staff number can be rewritten by a public request.
            existing.setName(request.name().trim());
            existing.setPasswordHash(passwordEncoder.encode(request.password()));
            Teacher saved = teacherRepository.save(existing);
            return sessionAuthService.issueToken(saved.getRole(), saved.getId(), saved.getName(), saved.getEmail(),
                    "APPROVED");
        }

        throw new ResponseStatusException(FORBIDDEN,
                "An administrator must add your staff account before you can register.");
    }

    @Transactional(readOnly = true)
    public String loginBudgetIdentity(String identity) {
        String value = identity.trim();
        return value.contains("@") ? value : studentRepository.findByStudentNumberIgnoreCase(value)
                .map(Student::getUniversityEmail).orElse(value);
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        String email = request.email().trim();

        Optional<Student> student = email.contains("@")
                ? studentRepository.findByUniversityEmailIgnoreCase(email)
                : studentRepository.findByStudentNumberIgnoreCase(email);
        if (student.isPresent() && matches(request.password(), student.get().getPasswordHash())) {
            Student found = student.get();
            if (STATUS_WITHDRAWN.equals(found.getStatus())) {
                throw new ResponseStatusException(UNAUTHORIZED,
                        "This account has been withdrawn. Contact an administrator.");
            }
            return sessionAuthService.issueToken(SessionAuthService.ROLE_STUDENT, found.getId(), found.getFullName(),
                    found.getUniversityEmail(), found.getApprovalStatus());
        }

        Optional<Teacher> teacher = teacherRepository.findByEmailIgnoreCase(email);
        if (teacher.isPresent() && matches(request.password(), teacher.get().getPasswordHash())) {
            Teacher found = teacher.get();
            if (STATUS_DEACTIVATED.equals(found.getStatus())) {
                throw new ResponseStatusException(UNAUTHORIZED,
                        "This account has been deactivated. Contact an administrator.");
            }
            return sessionAuthService.issueToken(found.getRole(), found.getId(), found.getName(), found.getEmail(),
                    "APPROVED");
        }

        throw new ResponseStatusException(UNAUTHORIZED, "Incorrect email or password.");
    }

    @Transactional(readOnly = true)
    public AuthResponse me(String token) {
        SessionAuthService.Principal principal = sessionAuthService.resolve(token);
        if (principal == null) {
            throw new ResponseStatusException(UNAUTHORIZED, "Your session has expired. Please sign in again.");
        }
        if (principal.role().equals(SessionAuthService.ROLE_STUDENT)) {
            Student student = studentRepository.findById(principal.id())
                    .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Account no longer exists."));
            if (STATUS_WITHDRAWN.equals(student.getStatus())) {
                throw new ResponseStatusException(UNAUTHORIZED, "This account has been withdrawn.");
            }
            return new AuthResponse(token, SessionAuthService.ROLE_STUDENT, student.getId(), student.getFullName(),
                    student.getUniversityEmail(), student.getApprovalStatus());
        }
        Teacher teacher = teacherRepository.findById(principal.id())
                .orElseThrow(() -> new ResponseStatusException(UNAUTHORIZED, "Account no longer exists."));
        if (STATUS_DEACTIVATED.equals(teacher.getStatus())) {
            // Recheck the profile in case its status changed after session resolution.
            throw new ResponseStatusException(UNAUTHORIZED, "This account has been deactivated.");
        }
        if (!principal.role().equals(teacher.getRole())) {
            throw new ResponseStatusException(UNAUTHORIZED, "Your role changed. Please sign in again.");
        }
        return new AuthResponse(token, teacher.getRole(), teacher.getId(), teacher.getName(), teacher.getEmail(), "APPROVED");
    }

    private boolean matches(String rawPassword, String storedHash) {
        return storedHash != null && passwordEncoder.matches(rawPassword, storedHash);
    }

    /** Student records keep separate first/last name columns; self-registration only collects one field. */
    private String[] splitFullName(String fullName) {
        int spaceIndex = fullName.indexOf(' ');
        if (spaceIndex < 0) {
            return new String[] {fullName, ""};
        }
        return new String[] {fullName.substring(0, spaceIndex), fullName.substring(spaceIndex + 1).trim()};
    }
}
