package io.github.huijingmen.softeng789.classroommonitoring.controller;

import io.github.huijingmen.softeng789.classroommonitoring.dto.CreateStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.dto.FaceEnrollmentCaptureResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.FaceEnrollmentResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.PageResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.StudentDirectoryItemResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.StudentResponse;
import io.github.huijingmen.softeng789.classroommonitoring.dto.UpdateStudentRequest;
import io.github.huijingmen.softeng789.classroommonitoring.service.FaceEnrollmentService;
import io.github.huijingmen.softeng789.classroommonitoring.service.ProtectedMediaService;
import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import io.github.huijingmen.softeng789.classroommonitoring.service.StaffAccessService;
import io.github.huijingmen.softeng789.classroommonitoring.service.StudentDirectoryService;
import io.github.huijingmen.softeng789.classroommonitoring.service.StudentService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import static org.springframework.http.HttpStatus.CREATED;

@RestController
@RequestMapping("/api/students")
public class StudentController {
    private final io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.StudentSignupProfiles signupProfiles;
    private final StudentService studentService;
    private final StudentDirectoryService studentDirectoryService;
    private final FaceEnrollmentService faceEnrollmentService;
    private final SessionAuthService sessionAuthService;
    private final StaffAccessService staffAccessService;
    private final ProtectedMediaService protectedMediaService;

    public StudentController(
            StudentService studentService,
            StudentDirectoryService studentDirectoryService,
            FaceEnrollmentService faceEnrollmentService,
            SessionAuthService sessionAuthService,
            StaffAccessService staffAccessService,
            ProtectedMediaService protectedMediaService,
            io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks.StudentSignupProfiles signupProfiles
    ) {
        this.signupProfiles = signupProfiles;
        this.studentService = studentService;
        this.studentDirectoryService = studentDirectoryService;
        this.faceEnrollmentService = faceEnrollmentService;
        this.sessionAuthService = sessionAuthService;
        this.staffAccessService = staffAccessService;
        this.protectedMediaService = protectedMediaService;
    }

    public record GuardianReview(@jakarta.validation.constraints.NotNull UUID revision,
            @jakarta.validation.constraints.NotBlank String method,
            @jakarta.validation.constraints.AssertTrue boolean relationshipConfirmed) {}

    @GetMapping("/{id}/signup-profile")
    public io.github.huijingmen.softeng789.classroommonitoring.dto.StudentProfileResponse signupProfile(
            @PathVariable UUID id, @RequestHeader(value="Authorization",required=false) String header,
            jakarta.servlet.http.HttpServletResponse response) {
        sessionAuthService.requireAdmin(header);
        response.setHeader("Cache-Control","no-store");
        return signupProfiles.read(id);
    }
    @PostMapping("/{id}/guardian-confirmation")
    public io.github.huijingmen.softeng789.classroommonitoring.dto.StudentProfileResponse confirmGuardian(
            @PathVariable UUID id, @Valid @RequestBody GuardianReview review,
            @RequestHeader(value="Authorization",required=false) String header) {
        return signupProfiles.confirmGuardian(id,sessionAuthService.requireAdmin(header),review.revision(),review.method());
    }

    @GetMapping
    public List<StudentResponse> listStudents(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        UUID callerId = sessionAuthService.requireTeacher(authorization);
        return studentService.listStudents(callerId);
    }

    @GetMapping("/page")
    public PageResponse<StudentResponse> listStudentsPage(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        UUID callerId = sessionAuthService.requireTeacher(authorization);
        return studentService.listStudents(callerId, page, size);
    }

    @GetMapping("/directory")
    public PageResponse<StudentDirectoryItemResponse> listStudentDirectory(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String course,
            @RequestParam(required = false) String level,
            @RequestParam(defaultValue = "attendance") String sort,
            @RequestParam(defaultValue = "asc") String direction,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        UUID callerId = sessionAuthService.requireTeacher(authorization);
        return studentDirectoryService.list(
                callerId,
                page,
                size,
                query,
                course,
                level,
                sort,
                direction
        );
    }

    @GetMapping("/{id}")
    public StudentResponse getStudent(
            @PathVariable UUID id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireSelfOrTeacher(authorization, id)
                .ifPresent(callerId -> staffAccessService.requireStudentAccess(callerId, id));
        return studentService.getStudent(id);
    }

    @PostMapping
    @ResponseStatus(CREATED)
    public StudentResponse createStudent(
            @Valid @RequestBody CreateStudentRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireAdmin(authorization);
        return studentService.createStudent(request);
    }

    @PutMapping("/{id}")
    public StudentResponse updateStudent(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateStudentRequest request,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireAdmin(authorization);
        return studentService.updateStudent(id, request);
    }

    @PostMapping("/{id}/face-enrollment")
    public FaceEnrollmentResponse enrolFace(
            @PathVariable UUID id,
            @RequestPart("image") MultipartFile image,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireSelfOrTeacher(authorization, id)
                .ifPresent(callerId -> staffAccessService.requireStudentAccess(callerId, id));
        return faceEnrollmentService.enrolFace(id, image);
    }

    @PostMapping("/{id}/face-enrollment/captures")
    public FaceEnrollmentResponse enrolFaceCaptures(
            @PathVariable UUID id,
            @RequestPart("metadata") String metadata,
            @RequestPart("images") List<MultipartFile> images,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireSelfOrTeacher(authorization, id)
                .ifPresent(callerId -> staffAccessService.requireStudentAccess(callerId, id));
        return faceEnrollmentService.enrolFaceCaptures(id, metadata, images);
    }

    @GetMapping("/{id}/face-enrollment/captures")
    public List<FaceEnrollmentCaptureResponse> listFaceEnrollmentCaptures(
            @PathVariable UUID id,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        sessionAuthService.requireSelfOrTeacher(authorization, id)
                .ifPresent(callerId -> staffAccessService.requireStudentAccess(callerId, id));
        return faceEnrollmentService.listCaptures(id);
    }

    @GetMapping("/{id}/face-enrollment/photo")
    public ResponseEntity<Resource> getFaceEnrollmentPhoto(
            @PathVariable UUID id,
            @RequestParam("access") String accessToken
    ) {
        protectedMediaService.requireFacePhoto(accessToken, id);
        return ResponseEntity.ok()
                .contentType(faceEnrollmentService.photoMediaType())
                .body(faceEnrollmentService.getPhoto(id));
    }

    @GetMapping("/{id}/face-enrollment/captures/{pose}/photo")
    public ResponseEntity<Resource> getFaceEnrollmentCapturePhoto(
            @PathVariable UUID id,
            @PathVariable String pose,
            @RequestParam("access") String accessToken
    ) {
        protectedMediaService.requireFaceCapture(accessToken, id, faceEnrollmentService.safePose(pose));
        return ResponseEntity.ok()
                .contentType(faceEnrollmentService.photoMediaType())
                .body(faceEnrollmentService.getCapturePhoto(id, pose));
    }
}
