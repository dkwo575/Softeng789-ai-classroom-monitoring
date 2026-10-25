ALTER TABLE webcam_sharing_runs DROP CONSTRAINT webcam_sharing_runs_camera_state_check;
ALTER TABLE webcam_sharing_runs ADD CONSTRAINT webcam_sharing_runs_camera_state_check
    CHECK (camera_state IN ('STARTING','RUNNING','PAUSED','STOPPED'));
ALTER TABLE webcam_observations DROP CONSTRAINT webcam_observations_review_state_check;
ALTER TABLE webcam_observations ADD CONSTRAINT webcam_observations_review_state_check
    CHECK (review_state IN ('INFO','PENDING','REVIEWED','FALSE_POSITIVE'));
UPDATE webcam_observations SET review_state = 'INFO'
    WHERE review_state = 'PENDING' AND kind NOT IN ('NO_FACE','MULTIPLE_FACES');
CREATE INDEX idx_webcam_observation_review ON webcam_observations(run_id, review_state, received_at DESC);
