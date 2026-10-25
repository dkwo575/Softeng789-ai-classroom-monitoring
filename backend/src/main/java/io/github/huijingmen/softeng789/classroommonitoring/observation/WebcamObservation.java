package io.github.huijingmen.softeng789.classroommonitoring.observation;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "webcam_observations")
public class WebcamObservation {
    @Id UUID id;
    @Column(nullable = false) UUID runId;
    @Column(nullable = false, length = 30) String kind;
    @Column(nullable = false) int durationMs;
    @Column(nullable = false) Instant receivedAt;
    @Column(nullable = false, length = 20) String reviewState;
    Instant reviewedAt;
    UUID reviewedBy;
}
