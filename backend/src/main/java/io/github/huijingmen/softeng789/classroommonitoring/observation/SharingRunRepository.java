package io.github.huijingmen.softeng789.classroommonitoring.observation;

import java.time.Instant;
import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SharingRunRepository extends JpaRepository<SharingRun, UUID> {
    List<SharingRun> findByStudentIdAndExpiresAtAfterOrderByCreatedAtDesc(UUID studentId, Instant now);
    List<SharingRun> findBySessionIdAndExpiresAtAfterOrderByCreatedAtDesc(UUID sessionId, Instant now);
}
