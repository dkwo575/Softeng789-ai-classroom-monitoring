package io.github.huijingmen.softeng789.classroommonitoring.observation;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "webcam_sharing_runs")
public class SharingRun {
    @Id UUID id;
    @Column(nullable = false) UUID studentId;
    @Column(nullable = false) UUID sessionId;
    @Column(nullable = false, length = 80) String noticeVersion;
    @Column(nullable = false) Instant createdAt;
    @Column(nullable = false) Instant expiresAt;
    @Column(nullable = false) Instant lastHeartbeat;
    Instant stoppedAt;
    @Column(nullable = false) long sequence;
    @Column(nullable = false, length = 20) String cameraState;
}
