package io.github.huijingmen.softeng789.classroommonitoring.dto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
public record UpdateSelfProfileRequest(@NotNull Long version, @NotNull @Valid StudentProfileInput profile) {
    @Override public String toString() { return "UpdateSelfProfileRequest[redacted]"; }
}