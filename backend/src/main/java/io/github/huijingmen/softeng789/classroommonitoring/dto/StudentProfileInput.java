package io.github.huijingmen.softeng789.classroommonitoring.dto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
/** Contact email is separate from the login identity. */
public record StudentProfileInput(@Past LocalDate dateOfBirth, @Size(max=160) String schoolName,
        @Size(max=500) String address, @Size(max=40) String phone,
        @Email @Size(max=255) String contactEmail, @Valid GuardianInput guardian) {
    public record GuardianInput(@NotBlank @Size(max=160) String name,
            @NotBlank @Size(max=80) String relationship,
            @NotBlank @Email @Size(max=255) String email, @NotBlank @Size(max=40) String phone) {
        @Override public String toString() { return "GuardianInput[redacted]"; }
    }
    @Override public String toString() { return "StudentProfileInput[redacted]"; }
}