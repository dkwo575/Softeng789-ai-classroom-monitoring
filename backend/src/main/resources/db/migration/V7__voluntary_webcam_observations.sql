-- Event metadata only. No images, landmarks, identity templates or attention scores.
CREATE TABLE webcam_sharing_runs (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES classroom_sessions(id) ON DELETE CASCADE,
    notice_version varchar(80) NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    last_heartbeat timestamptz NOT NULL,
    stopped_at timestamptz,
    sequence bigint NOT NULL DEFAULT 0,
    camera_state varchar(20) NOT NULL CHECK (camera_state IN ('STARTING','RUNNING','STOPPED'))
);
CREATE INDEX idx_webcam_run_session ON webcam_sharing_runs(session_id, created_at DESC);
CREATE INDEX idx_webcam_run_student ON webcam_sharing_runs(student_id, created_at DESC);
CREATE INDEX idx_webcam_run_expiry ON webcam_sharing_runs(expires_at);
CREATE TABLE webcam_observations (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES webcam_sharing_runs(id) ON DELETE CASCADE,
    kind varchar(30) NOT NULL CHECK (kind IN ('NO_FACE','ONE_FACE','MULTIPLE_FACES','HEAD_TURN','HEAD_TILT','POSE_UNAVAILABLE')),
    duration_ms integer NOT NULL CHECK (duration_ms BETWEEN 1000 AND 60000),
    received_at timestamptz NOT NULL,
    review_state varchar(20) NOT NULL CHECK (review_state IN ('PENDING','REVIEWED','FALSE_POSITIVE')),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES teachers(id) ON DELETE SET NULL
);
CREATE INDEX idx_webcam_observation_run_time ON webcam_observations(run_id, received_at DESC, id DESC);
CREATE INDEX idx_webcam_observation_reviewer ON webcam_observations(reviewed_by);
