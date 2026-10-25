package io.github.huijingmen.softeng789.classroommonitoring.observation;

import java.util.*;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WebcamObservationRepository extends JpaRepository<WebcamObservation, UUID> {
    List<WebcamObservation> findByRunIdInOrderByReceivedAtDescIdDesc(Collection<UUID> runs, Pageable page);
    long countByRunId(UUID runId);
    @Query("select e from WebcamObservation e where e.runId in :runs and e.reviewState = 'PENDING' "
        + "and e.kind in ('NO_FACE','MULTIPLE_FACES') order by e.receivedAt desc, e.id desc")
    List<WebcamObservation> findChecks(@Param("runs") Collection<UUID> runs, Pageable page);
    interface Totals {
        UUID getRunId(); String getKind(); String getReviewState(); long getCount();
    }
    @Query("select e.runId as runId, e.kind as kind, e.reviewState as reviewState, count(e) as count "
        + "from WebcamObservation e where e.runId in :runs group by e.runId, e.kind, e.reviewState")
    List<Totals> summarize(@Param("runs") Collection<UUID> runs);
}
