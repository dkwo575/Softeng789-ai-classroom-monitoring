package io.github.huijingmen.softeng789.classroommonitoring.service;

import io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.StudentSignupProfiles;
import io.github.huijingmen.softeng789.classroommonitoring.dto.CreateStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.FaceEnrollmentCaptureResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.PendingStudentResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.PageResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.StudentResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.UpdateStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.UpdateStudentStatusRequest;
import io.github.huijingmen.softeng789.classroommonitoring.entity.CourseEnrollment;
import io.github.huijingmen.softeng789.classroommonitoring.entity.FaceEnrollment;
import io.github.huijingmen.softeng789.classroommonitoring.entity.FaceEnrollmentStatus;
import io.github.huijingmen.softeng789.classroommonitoring.entity.Student;
import io.github.huijingmen.softeng789.classroommonitoring.entity.StudentLevel;
import io.github.huijingmen.softeng789.classroommonitoring.repository.CourseEnrollmentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.FaceEnrollmentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.repository.StudentRepository;
import io.github.huijingmen.softeng789.classroommonitoring.vision.RegistrationFaceService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.data.domain.Page;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.NOT_FOUND;

@Service
public class StudentService {
    private static final Set<String> VALID_STATUSES = Set.of("ACTIVE", "WITHDRAWN");

    private final StudentRepository studentRepository;
    private final FaceEnrollmentRepository faceEnrollmentRepository;
    private final CourseLookupService courseLookupService;
    private final CourseEnrollmentRepository courseEnrollmentRepository;
    private final FaceEnrollmentStorageService faceEnrollmentStorageService;
    private final SessionAuthService sessionAuthService;
    private final TeacherScopeSupport teacherScopeSupport;
    private final RegistrationFaceService registrationFaces;
    private final StudentSignupProfiles signupProfiles;

    public StudentService(
            StudentRepository studentRepository,
            FaceEnrollmentRepository faceEnrollmentRepository,
            CourseLookupService courseLookupService,
            CourseEnrollmentRepository courseEnrollmentRepository,
            FaceEnrollmentStorageService faceEnrollmentStorageService,
            SessionAuthService sessionAuthService,
            TeacherScopeSupport teacherScopeSupport,
            RegistrationFaceService registrationFaces,
            StudentSignupProfiles signupProfiles
    ) {
        this.registrationFaces = registrationFaces;
        this.signupProfiles = signupProfiles;
        this.studentRepository = studentRepository;
        this.faceEnrollmentRepository = faceEnrollmentRepository;
        this.courseLookupService = courseLookupService;
        this.courseEnrollmentRepository = courseEnrollmentRepository;
        this.faceEnrollmentStorageService = faceEnrollmentStorageService;
        this.sessionAuthService = sessionAuthService;
        this.teacherScopeSupport = teacherScopeSupport;
    }

    // A self-registration is not a real student until an Admin approves it — PENDING and REJECTED
    // rows must stay invisible here, the same way they're already excluded from rosters,
    // attendance and counts, or an unreviewed (or explicitly rejected) sign-up would show up
    // everywhere in the app as if they were an enrolled student. A plain teacher only sees
    // students enrolled in a class they actually teach — an admin still sees everyone.
    @Transactional(readOnly = true)
    public List<StudentResponse> listStudents(UUID callerId) {
        boolean admin = teacherScopeSupport.isAdmin(teacherScopeSupport.requireCaller(callerId));
        List<Student> visible = admin
                ? studentRepository.findByApprovalStatusOrderByLastNameAscFirstNameAsc("APPROVED")
                : studentRepository.findApprovedStudentsVisibleToTeacher(
                        callerId, CourseEnrollment.EnrollmentStatus.ACTIVE);
        return toResponses(visible);
    }

    @Transactional(readOnly = true)
    public PageResponse<StudentResponse> listStudents(UUID callerId, int page, int size) {
        boolean admin = teacherScopeSupport.isAdmin(teacherScopeSupport.requireCaller(callerId));
        var pageRequest = PageRequestSupport.create(page, size);
        Page<Student> visible = admin
                ? studentRepository.findByApprovalStatusOrderByLastNameAscFirstNameAscIdAsc(
                        "APPROVED",
                        pageRequest
                )
                : studentRepository.findApprovedStudentsVisibleToTeacher(
                        callerId,
                        CourseEnrollment.EnrollmentStatus.ACTIVE,
                        pageRequest
                );
        return PageResponse.from(visible, toResponses(visible.getContent()));
    }

    @Transactional(readOnly = true)
    public StudentResponse getStudent(UUID id) {
        return toResponse(findEntity(id));
    }

    @Transactional(readOnly = true)
    public List<PendingStudentResponse> listPendingStudents() {
        return studentRepository.findByApprovalStatusOrderByCreatedAtAsc("PENDING").stream()
                .map(this::toPendingResponse)
                .toList();
    }

    // Approving is the one action a student's pending registration needs: it activates the
    // account AND turns every class they picked at registration into a real (ACTIVE) enrolment in
    // the same step, rather than making an Admin separately open Classes and add them by hand.
    @Transactional
    public StudentResponse approveStudent(UUID id) {
        return approveStudent(id, null, false);
    }

    @Transactional
    public StudentResponse approveStudent(UUID id, UUID admin, boolean identityConfirmed) {
        Student student = registrationFaces.lockStudent(id);
        if (!"PENDING".equals(student.getApprovalStatus())) {
            throw new ResponseStatusException(BAD_REQUEST, "Student is not pending approval.");
        }
        signupProfiles.requireApproval(student);
        registrationFaces.approve(id, admin, identityConfirmed);
        student.setApprovalStatus("APPROVED");
        student = studentRepository.save(student);

        for (CourseEnrollment enrollment : courseEnrollmentRepository
                .findByStudent_IdAndStatus(id, CourseEnrollment.EnrollmentStatus.PENDING)) {
            enrollment.setStatus(CourseEnrollment.EnrollmentStatus.ACTIVE);
            enrollment.setEnrolledAt(Instant.now());
            courseEnrollmentRepository.save(enrollment);
        }
        return toResponse(student);
    }

    // The other way a pending registration can end. REJECTED is terminal and, unlike approval,
    // deliberately does not delete the account — the student keeps their login and sees a clear
    // "not approved" message (see PendingApproval on the frontend) instead of silently losing
    // access, and the same student number/email can't be used to just re-register around it. The
    // PENDING enrolments they picked at sign-up are removed outright rather than left dangling,
    // since they can now never become ACTIVE.
    @Transactional
    public StudentResponse rejectStudent(UUID id) {
        Student student = registrationFaces.lockStudent(id);
        if (!"PENDING".equals(student.getApprovalStatus())) {
            throw new ResponseStatusException(BAD_REQUEST, "Student is not pending approval.");
        }
        registrationFaces.reject(id);
        student.setApprovalStatus("REJECTED");
        student = studentRepository.save(student);

        courseEnrollmentRepository.deleteAll(
                courseEnrollmentRepository.findByStudent_IdAndStatus(id, CourseEnrollment.EnrollmentStatus.PENDING));
        return toResponse(student);
    }

    @Transactional
    public StudentResponse createStudent(CreateStudentRequest request) {
        requireUniqueStudentNumber(request.studentNumber(), null);
        requireUniqueUniversityEmail(request.universityEmail(), null);
        List<String> courses = normaliseCourses(request.course(), request.courses());

        Student student = new Student();
        apply(student, request.studentNumber(), request.universityEmail(), request.firstName(),
                request.lastName(), courses.get(0), request.seat(), request.programme(),
                request.consentGiven(), request.level());
        student = studentRepository.save(student);
        return toResponse(student);
    }

    @Transactional
    public StudentResponse updateStudent(UUID id, UpdateStudentRequest request) {
        Student student = findEntity(id);
        requireUniqueStudentNumber(request.studentNumber(), id);
        requireUniqueUniversityEmail(request.universityEmail(), id);
        List<String> courses = normaliseCourses(request.course(), request.courses());

        apply(student, request.studentNumber(), request.universityEmail(), request.firstName(),
                request.lastName(), courses.get(0), request.seat(), request.programme(),
                request.consentGiven(), request.level());
        student = studentRepository.save(student);
        return toResponse(student);
    }

    /**
     * Withdrawing a student is a whole-account soft-delete, distinct from the per-class WITHDRAWN
     * enrolment status that already existed — withdrawing pulls them out of every class they're
     * currently active in (so rosters/counts are immediately accurate) and revokes any live
     * session, but does NOT delete attendance history, past enrolments or face enrolment data.
     * Reactivating only restores login and eligibility for new enrolments — it deliberately does
     * not re-enrol them anywhere; an Admin re-adds them to whichever classes are relevant via the
     * existing Classes UI, which already reactivates a WITHDRAWN enrolment row if one exists.
     */
    @Transactional
    public StudentResponse updateStudentStatus(UUID id, UpdateStudentStatusRequest request) {
        String status = request.status().trim().toUpperCase(Locale.ROOT);
        if (!VALID_STATUSES.contains(status)) {
            throw new ResponseStatusException(BAD_REQUEST, "status must be ACTIVE or WITHDRAWN.");
        }
        Student student = findEntity(id);

        student.setStatus(status);
        student = studentRepository.save(student);

        if ("WITHDRAWN".equals(status)) {
            for (CourseEnrollment enrollment : courseEnrollmentRepository
                    .findByStudent_IdAndStatus(id, CourseEnrollment.EnrollmentStatus.ACTIVE)) {
                enrollment.setStatus(CourseEnrollment.EnrollmentStatus.WITHDRAWN);
                enrollment.setWithdrawnAt(Instant.now());
                courseEnrollmentRepository.save(enrollment);
            }
            sessionAuthService.revokeSessionsFor(id);
        }
        return toResponse(student);
    }

    // The one real mutation FaceEnrollmentService needs to make to a Student — exposed as its own
    // method rather than that service reaching in via findEntity()+save() directly, so any future
    // invariant added here is guaranteed to apply to every caller instead of being silently
    // bypassable from outside this class.
    @Transactional
    public void updateFaceEnrollmentStatus(UUID studentId, FaceEnrollmentStatus status) {
        Student student = findEntity(studentId);
        student.setFaceEnrollmentStatus(status);
        studentRepository.save(student);
    }

    Student findEntity(UUID id) {
        return studentRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(NOT_FOUND, "Student not found."));
    }

    StudentResponse toResponse(Student student) {
        boolean hasPhoto = faceEnrollmentRepository.findByStudent_Id(student.getId()).isPresent();
        EnrollmentSnapshot enrollment = activeEnrollmentSnapshot(student);
        return toResponse(student, hasPhoto, enrollment.courses(), enrollment.offeringIds(), true);
    }

    List<StudentResponse> toResponses(List<Student> students) {
        if (students.isEmpty()) {
            return List.of();
        }
        List<UUID> studentIds = students.stream().map(Student::getId).toList();
        Set<UUID> studentsWithPhotos = faceEnrollmentRepository.findByStudent_IdIn(studentIds).stream()
                .map(FaceEnrollment::getStudent)
                .map(Student::getId)
                .collect(Collectors.toSet());
        List<CourseEnrollment> activeEnrollments = courseEnrollmentRepository
                .findByStudent_IdInAndStatusOrderByCourseOffering_Course_CodeAsc(
                        studentIds, CourseEnrollment.EnrollmentStatus.ACTIVE);
        Map<UUID, List<String>> coursesByStudent = activeEnrollments.stream()
                .collect(Collectors.groupingBy(
                        enrollment -> enrollment.getStudent().getId(),
                        Collectors.mapping(
                                enrollment -> enrollment.getCourseOffering().getCourse().getCode(),
                                Collectors.collectingAndThen(
                                        Collectors.toCollection(LinkedHashSet::new),
                                        List::copyOf
                                )
                        )
                ));
        Map<UUID, List<UUID>> offeringIdsByStudent = activeEnrollments.stream()
                .collect(Collectors.groupingBy(
                        enrollment -> enrollment.getStudent().getId(),
                        Collectors.mapping(
                                enrollment -> enrollment.getCourseOffering().getId(),
                                Collectors.collectingAndThen(
                                        Collectors.toCollection(LinkedHashSet::new),
                                        List::copyOf
                                )
                        )
                ));

        return students.stream()
                .map(student -> toResponse(
                        student,
                        studentsWithPhotos.contains(student.getId()),
                        coursesByStudent.getOrDefault(student.getId(), List.of(student.getCourse())),
                        offeringIdsByStudent.getOrDefault(student.getId(), List.of()),
                        false
                ))
                .toList();
    }

    private StudentResponse toResponse(
            Student student,
            boolean hasPhoto,
            List<String> courses,
            List<UUID> offeringIds,
            boolean includeCaptures
    ) {
        String photoUrl = hasPhoto ? faceEnrollmentStorageService.photoUrl(student.getId()) : null;

        return new StudentResponse(
                student.getId(),
                student.getStudentNumber(),
                student.getUniversityEmail(),
                student.getFirstName(),
                student.getLastName(),
                student.getCourse(),
                courses,
                offeringIds,
                student.getSeat(),
                student.getProgramme(),
                student.isConsentGiven(),
                student.getFaceEnrollmentStatus(),
                photoUrl,
                includeCaptures ? faceEnrollmentCaptures(student.getId()) : List.of(),
                student.getCreatedAt(),
                student.getUpdatedAt(),
                student.getStatus(),
                student.getLevel()
        );
    }

    private void apply(
            Student student,
            String studentNumber,
            String universityEmail,
            String firstName,
            String lastName,
            String course,
            String seat,
            String programme,
            Boolean consentGiven,
            StudentLevel level
    ) {
        student.setStudentNumber(studentNumber.trim());
        student.setUniversityEmail(universityEmail.trim());
        student.setFirstName(firstName.trim());
        student.setLastName(lastName.trim());
        student.setCourse(course.trim());
        student.setSeat(seat.trim());
        student.setProgramme(programme.trim());
        student.setConsentGiven(Boolean.TRUE.equals(consentGiven));
        student.setLevel(level);
    }

    private List<String> normaliseCourses(String primaryCourse, List<String> requestedCourses) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        if (primaryCourse != null && !primaryCourse.isBlank()) {
            values.add(courseLookupService.normaliseCourseCode(primaryCourse));
        }
        if (requestedCourses != null) {
            requestedCourses.stream()
                    .filter(course -> course != null && !course.isBlank())
                    .map(courseLookupService::normaliseCourseCode)
                    .forEach(values::add);
        }
        if (values.isEmpty()) {
            throw new ResponseStatusException(org.springframework.http.HttpStatus.BAD_REQUEST,
                    "At least one enrolled course is required.");
        }
        return new ArrayList<>(values);
    }

    // Real class assignment now lives entirely in Admin's class management (AdminClassService) —
    // this just reports whatever classes Admin has actually enrolled the student in. Falls back to
    // the descriptive course field only when the student hasn't been assigned to a class yet.
    private EnrollmentSnapshot activeEnrollmentSnapshot(Student student) {
        List<CourseEnrollment> enrollments = courseEnrollmentRepository
                .findByStudent_IdOrderByCourseOffering_Course_CodeAsc(student.getId())
                .stream()
                .filter(enrollment -> enrollment.getStatus() == CourseEnrollment.EnrollmentStatus.ACTIVE)
                .toList();
        List<String> courses = enrollments.stream()
                .map(enrollment -> enrollment.getCourseOffering().getCourse().getCode())
                .distinct()
                .toList();
        List<UUID> offeringIds = enrollments.stream()
                .map(enrollment -> enrollment.getCourseOffering().getId())
                .distinct()
                .toList();
        return new EnrollmentSnapshot(
                courses.isEmpty() ? List.of(student.getCourse()) : courses,
                offeringIds
        );
    }

    private record EnrollmentSnapshot(List<String> courses, List<UUID> offeringIds) {
    }

    private PendingStudentResponse toPendingResponse(Student student) {
        List<String> requestedClasses = courseEnrollmentRepository
                .findByStudent_IdAndStatus(student.getId(), CourseEnrollment.EnrollmentStatus.PENDING)
                .stream()
                .map(enrollment -> enrollment.getCourseOffering().getCourse().getCode())
                .toList();
        var faceReview = registrationFaces.summary(student.getId());
        return new PendingStudentResponse(
                student.getId(),
                student.getStudentNumber(),
                student.getUniversityEmail(),
                student.getFullName(),
                requestedClasses,
                student.getFaceEnrollmentStatus(),
                student.isConsentGiven(),
                student.getCreatedAt(), faceReview.attendanceMode(), faceReview.faceReviewState()
        );
    }

    private List<FaceEnrollmentCaptureResponse> faceEnrollmentCaptures(UUID studentId) {
        return faceEnrollmentStorageService.listCaptures(studentId);
    }

    private void requireUniqueStudentNumber(String studentNumber, UUID currentId) {
        studentRepository.findByStudentNumberIgnoreCase(studentNumber.trim()).ifPresent(existing -> {
            if (!existing.getId().equals(currentId)) {
                throw new ResponseStatusException(CONFLICT, "Student number already exists.");
            }
        });
    }

    private void requireUniqueUniversityEmail(String universityEmail, UUID currentId) {
        studentRepository.findByUniversityEmailIgnoreCase(universityEmail.trim()).ifPresent(existing -> {
            if (!existing.getId().equals(currentId)) {
                throw new ResponseStatusException(CONFLICT, "University email already exists.");
            }
        });
    }
}
