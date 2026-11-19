package io.github.huijingmen.softeng789.classroommonitoring.dto;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
public record StudentProfileResponse(UUID id, String studentNumber, String name, String loginEmail,
        LocalDate dateOfBirth, String schoolName, String address, String phone, String contactEmail,
        Long version, boolean signupChecksRequired, Instant emailVerifiedAt, Guardian guardian) {
    public record Guardian(String name, String relationship, String email, String phone,
            Instant emailVerifiedAt, Instant signupConsentedAt, Instant relationshipConfirmedAt, UUID revision) {
        @Override public String toString() { return "Guardian[redacted]"; }
    }
    @Override public String toString() { return "StudentProfileResponse[redacted]"; }
}