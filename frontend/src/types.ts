export type Page =
  | 'dashboard'
  | 'live'
  | 'attendance'
  | 'session-detail'
  | 'students'
  | 'achievements'
  | 'events'
  | 'reports'
  | 'settings'
  | 'staff'
  | 'classes'
  | 'campuses'
  | 'registrations'
  | 'requests'
  | 'payments'
  | 'health-alerts'
  | 'kiosk'
  | 'kiosk-reviews';

export interface SessionDetailOrigin {
  page: Exclude<Page, 'session-detail'>;
  label: string;
  classId?: string;
}

export type Theme = 'dark' | 'light';

export type UserRole = 'student' | 'teacher' | 'admin';

/** A signed-in browser: a person's account, or an entrance kiosk launched by staff (never registerable). */
export type AccountRole = UserRole | 'kiosk';

export interface AuthUser {
  role: AccountRole;
  /** Backend UUID for the student or teacher record, or the kiosk session for role 'kiosk'. */
  id: string;
  name: string;
  email: string;
  /** Only meaningful for a student — a self-registration is PENDING until an Admin reviews it,
   *  then either APPROVED or REJECTED. Always APPROVED for teachers/admins. */
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterStudentPayload {
  profile?: {
    dateOfBirth: string | null; schoolName: string; address: string; phone: string; contactEmail: string;
    guardian: { name: string; relationship: string; email: string; phone: string } | null;
  };
  attendanceMode?: "MANUAL" | "FACE";
  adultConfirmed?: boolean;
  noticeVersion?: string;
  /** Only needed to claim an existing passwordless student account. */
  emailProof?: string;
  studentNumber: string;
  universityEmail: string;
  fullName: string;
  course: string;
  classOfferingIds: string[];
  password: string;
  consentGiven: boolean;
  level: StudentLevel;
}

export interface RegisterTeacherPayload {
  emailProof: string;
  staffNumber: string;
  email: string;
  name: string;
  password: string;
}

export type StaffStatus = 'active' | 'deactivated';

export interface StaffMember {
  id: string;
  staffNumber: string;
  email: string;
  name: string;
  role: 'teacher' | 'admin';
  passwordSet: boolean;
  status: StaffStatus;
}

export interface CreateStaffPayload {
  staffNumber: string;
  email: string;
  name: string;
  role: 'teacher' | 'admin';
}

export interface StudentAttendanceHistoryEntry {
  sessionId: string;
  course: string;
  room: string;
  campusId: string | null;
  campusName: string | null;
  sessionDate: string;
  startTime: string;
  endTime: string;
  status: AttendanceStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  source: AttendanceSource | null;
}

export type AttendanceStatus = 'Present' | 'Late' | 'Absent' | 'Unknown';

export type AttendanceSource = 'MANUAL' | 'AI';

export type SessionStatusCode = 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type EventStatus = 'Pending Review' | 'Confirmed' | 'Rejected' | 'Corrected';

export type EventType =
  | 'Prolonged head-down posture'
  | 'Leaving the seat area'
  | 'Potential peer interaction'
  | 'Extended off-desk hand movement'
  | 'No observable concern (false positive)';

export type MonitorState = 'stopped' | 'running' | 'paused';

export type StudentRecordStatus = 'Active' | 'At risk' | 'Enrolment pending';

export type StudentLevel = 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3' | 'LEVEL_4';

export type FaceEnrollmentStatus = 'NOT_ENROLLED' | 'PHOTO_CAPTURED' | 'VERIFIED' | 'FAILED';

export type FaceEnrollmentPose =
  | 'front'
  | 'slight_left'
  | 'left'
  | 'slight_right'
  | 'right'
  | 'chin_up'
  | 'chin_down'
  | 'blink';

export interface Campus {
  id: string;
  name: string;
  roomCount: number;
}

export interface Room {
  id: string;
  campusId: string;
  campusName: string;
  code: string;
  name: string;
  capacity: number;
}

export interface Session {
  id: string;
  /** Backend UUID. Present when the session was loaded from Spring Boot. */
  recordId?: string;
  courseOfferingId?: string | null;
  courseOfferingCode?: string | null;
  course: string;
  title: string;
  room: string;
  roomId?: string | null;
  campusId?: string | null;
  campusName?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  teacherEmail?: string | null;
  /** Shared by occurrences generated from one weekly timetable slot; absent for one-off sessions. */
  scheduleSeriesId?: string | null;
  /** ISO date, used for range filters and sorting. */
  date: string;
  dateLabel: string;
  time: string;
  /** Raw ISO instants behind `time` — kept around so the edit form can reconstruct start/end
   *  time inputs without re-parsing the already-formatted display string. */
  startTime: string;
  endTime: string;
  enrolled: number;
  status: 'Scheduled' | 'Live' | 'Completed' | 'Cancelled';
  statusCode?: SessionStatusCode;
}

export interface NewClassroomSession {
  courseOfferingId: string;
  /** Course code of the selected class, e.g. "SOFTENG 789" — used for local enrolled-count lookup. */
  courseLabel: string;
  roomId: string;
  teacherEmail: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface AttendanceRow {
  id: string | null;
  studentRecordId: string;
  studentNumber: string;
  studentName: string;
  /** Current profile level on the authoritative historical roster, not a current-enrolment lookup. */
  studentLevel?: StudentLevel | null;
  sessionId: string;
  status: AttendanceStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  source: AttendanceSource | null;
}

export interface Student {
  /** Backend UUID. Present when the record was loaded from Spring Boot. */
  recordId?: string;
  id: string;
  studentNumber?: string;
  name: string;
  /** Primary course, kept for backwards-compatible filters and summaries. */
  course: string;
  /** All course enrolments for this student. */
  courses?: string[];
  /** Exact class offerings used when matching attendance sessions across terms. */
  courseOfferingIds?: string[];
  /** Overall attendance rate as a percentage. Null until the backend exposes an aggregate. */
  rate: number | null;
  status: StudentRecordStatus;
  /** Account lifecycle: whether the student can log in / be enrolled in new classes. Distinct
   *  from `status` above, which is a derived face-enrolment health signal, not an account state. */
  accountStatus: 'active' | 'withdrawn';
  program: string;
  email: string;
  seat: string;
  level: StudentLevel;
  /** Frontend prototype capture used for supervised classroom registration. */
  registrationPhoto?: string;
  registeredAt?: string;
  consentRecorded?: boolean;
  faceEnrollmentStatus?: FaceEnrollmentStatus;
  faceEnrollmentMessage?: string;
  faceEnrollmentCaptures?: FaceEnrollmentCapture[];
}

export interface FaceEnrollmentCapture {
  pose: FaceEnrollmentPose;
  label: string;
  photo: string;
  qualityScore: number;
  poseScore: number;
  capturedAt: string;
  optional?: boolean;
}

export interface CandidateEvent {
  id: string;
  /** Null when the tracked person was never linked to a student record. */
  studentId: string | null;
  trackId: string;
  type: EventType;
  sessionId: string;
  start: string;
  duration: string;
  /** Detector score 0–1. Not a probability of being correct. */
  confidence: number;
  status: EventStatus;
  correctedFrom?: EventType;
}

export type HealthAlertStatus = 'awaiting-review' | 'confirmed' | 'dismissed';

/** An AI-detected candidate health/safety event (e.g. "possible fall") awaiting teacher review —
 *  never a confirmed fact on its own. Confirming one produces a linked HealthIncidentReport; a
 *  teacher can also report an incident directly with no AI involved, which skips this type
 *  entirely (see HealthIncidentReport below). */
export interface HealthAlert {
  id: string;
  studentId: string;
  studentName: string;
  sessionId: string;
  classLabel: string;
  room: string;
  detectedAt: string;
  eventType: string;
  confidence: number | null;
  source: string;
  status: HealthAlertStatus;
  evidenceUrl: string | null;
  reviewedByTeacherId: string | null;
  reviewedByTeacherName: string | null;
  reviewedAt: string | null;
  teacherNotes: string | null;
  actionTaken: string | null;
  createdAt: string;
}

export type HealthIncidentSource = 'ai-detected' | 'teacher-reported';

/** The formal health/safety record — a permanent record once created, either produced by
 *  confirming a HealthAlert (healthAlertId set) or reported directly by a teacher with no AI
 *  involved (healthAlertId null). */
export interface HealthIncidentReport {
  id: string;
  studentId: string;
  studentName: string;
  courseOfferingId: string;
  classLabel: string;
  sessionId: string | null;
  sessionLabel: string | null;
  teacherId: string;
  teacherName: string;
  source: HealthIncidentSource;
  incidentType: string;
  occurredAt: string;
  description: string;
  actionTaken: string | null;
  teacherNotes: string | null;
  healthAlertId: string | null;
  createdAt: string;
}

/** A class + its actively-enrolled roster, scoped server-side to the caller's own classes for a
 *  teacher, or every class for an admin — feeds the manual report form's Class/Student pickers. */
export interface HealthClassOption {
  courseOfferingId: string;
  label: string;
  students: { id: string; name: string; studentNumber: string }[];
}

/** Teacher feedback may include a camera photo from the responsive web workflow. */
export interface ProgressReport {
  id: string;
  studentId: string;
  studentName: string;
  courseOfferingId: string;
  classLabel: string;
  teacherId: string;
  teacherName: string;
  comment: string;
  photoUrl: string | null;
  createdAt: string;
}

/** A note about the class as a whole. It contributes to class and overall AI summaries but is
 * intentionally separate from ProgressReport so it never appears in a student's own history. */
export interface ClassFeedback {
  id: string;
  courseOfferingId: string;
  classLabel: string;
  teacherId: string;
  teacherName: string;
  comment: string;
  createdAt: string;
}

export type AccomplishmentCategory =
  | 'PROJECT'
  | 'MILESTONE'
  | 'AWARD'
  | 'IMPROVEMENT'
  | 'LEADERSHIP'
  | 'OTHER';

export type AccomplishmentStatus = 'DRAFT' | 'CONFIRMED' | 'REVOKED';

export type AccomplishmentCorrectionStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface AccomplishmentCorrection {
  id: string;
  status: AccomplishmentCorrectionStatus;
  message: string;
  staffResponse: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByTeacherName: string | null;
}

/** A positive student outcome recorded by a teacher. Drafts remain staff-only; the student portal
 * and exported reports receive shared achievements only. */
export interface Accomplishment {
  id: string;
  studentId: string;
  studentName: string;
  studentNumber: string;
  courseOfferingId: string;
  classLabel: string;
  category: AccomplishmentCategory;
  title: string;
  description: string | null;
  studentNote: string | null;
  points: number | null;
  achievementDate: string;
  includeInReport: boolean;
  status: AccomplishmentStatus;
  createdByTeacherId: string;
  createdByTeacherName: string;
  confirmedByTeacherName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  revokedAt: string | null;
  acknowledgedAt: string | null;
  latestCorrection: AccomplishmentCorrection | null;
}

export type FeedbackSummaryStatus = 'DRAFT' | 'REVIEWED' | 'SUPERSEDED';

/** AI-prepared, teacher-reviewed replacement for exposing a long list of raw feedback notes. */
export interface FeedbackSummary {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseOfferingId: string;
  classLabel: string;
  dateFrom: string;
  dateTo: string;
  summary: string;
  strengths: string;
  nextSteps: string;
  sourceFeedbackCount: number;
  provider: string;
  status: FeedbackSummaryStatus;
  createdByTeacherId: string;
  createdByTeacherName: string;
  reviewedByTeacherName: string | null;
  createdAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
  emailedAt: string | null;
}

export interface ReportInsight {
  scope: 'OVERALL' | 'CLASS';
  courseOfferingId: string | null;
  title: string;
  dateFrom: string;
  dateTo: string;
  summary: string;
  strengths: string;
  nextSteps: string;
  sourceFeedbackCount: number;
  provider: string;
}

export interface DetectionSettings {
  headDown: number;
  leaveSeat: number;
  confidence: number;
  requireConfirm: boolean;
  saveEvidence: boolean;
  blurFaces: boolean;
  notifyLive: boolean;
  retention: '7 days' | '30 days' | '90 days' | '12 months';
  privacy: 'Track ID only' | 'Track ID + seat' | 'Student name';
}

export interface SortState<K extends string> {
  key: K;
  dir: 1 | -1;
}
