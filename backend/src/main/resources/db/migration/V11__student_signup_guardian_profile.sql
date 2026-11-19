-- Additive upgrade; existing identifiers, records, sessions and consent domains are preserved.
ALTER TABLE students ADD COLUMN date_of_birth date,
    ADD COLUMN school_name varchar(160), ADD COLUMN address varchar(500),
    ADD COLUMN phone varchar(40), ADD COLUMN contact_email varchar(255),
    ADD COLUMN signup_checks_required boolean NOT NULL DEFAULT false,
    ADD COLUMN email_verified_at timestamptz, ADD COLUMN profile_revision bigint NOT NULL DEFAULT 0;
CREATE TABLE student_guardians (
    student_id uuid PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    name varchar(160) NOT NULL, relationship varchar(80) NOT NULL,
    email varchar(255) NOT NULL, phone varchar(40) NOT NULL, revision uuid NOT NULL,
    email_verified_at timestamptz, signup_consented_at timestamptz, notice_version varchar(80),
    relationship_confirmed_at timestamptz, relationship_confirmed_by uuid REFERENCES teachers(id),
    verification_method varchar(32), version bigint NOT NULL DEFAULT 0
);
ALTER TABLE account_links ADD COLUMN subject_id uuid, ADD COLUMN subject_revision varchar(64);
ALTER TABLE account_links DROP CONSTRAINT account_links_purpose_check;
ALTER TABLE account_links ADD CONSTRAINT account_links_purpose_check CHECK (purpose IN (
    'STUDENT_REGISTRATION', 'STAFF_ACTIVATION', 'PASSWORD_RESET', 'STUDENT_EMAIL', 'GUARDIAN_VERIFICATION'));
-- login_sessions_role_check remains unchanged, including KIOSK.
