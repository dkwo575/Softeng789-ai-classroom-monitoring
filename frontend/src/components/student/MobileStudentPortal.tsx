import { useEffect, useMemo, useRef, useState } from 'react';
import { ConsentPanel, StudentCheckInPanel } from '../../features/photo-attendance';
import { WebcamEventsEntry } from '../../features/webcam-events';
import BrandMark, { BRAND_NAME } from '../BrandMark';
import {
  ACCOMPLISHMENT_CATEGORIES,
  accomplishmentCategoryLabel,
  accomplishmentCorrectionLabel,
  formatAccomplishmentPoints
} from '../../lib/accomplishments';
import { acknowledgeAccomplishment, requestAccomplishmentCorrection } from '../../lib/accomplishmentApi';
import { apiMessage } from '../../lib/apiClient';
import { sessionRoomLabel } from '../../lib/classroomApi';
import { avatarTone, initials, statusClass } from '../../lib/format';
import { formatSessionDateLabel, formatSessionTimeRange, formatTimestampClock } from '../../lib/sessionTime';
import type { StudentAttendanceBenchmark, StudentSchedule } from '../../lib/studentPortalApi';
import { paymentSummaryCopy, StudentPaymentsView, type StudentPaymentStatement } from '../../features/payments';
import { PublishedStudentReports, type StudentReport } from '../../features/student-reports';
import type {
  Accomplishment,
  AuthUser,
  FeedbackSummary,
  ProgressReport,
  Student,
  StudentAttendanceHistoryEntry
} from '../../types';
import { useTheme } from '../../hooks/useTheme';
import RespondToAchievementModal from '../RespondToAchievementModal';
import StudentScheduleView from './StudentScheduleView';
import ThemeToggleButton from '../ThemeToggleButton';
import { MomentumFace, type ComparisonTone } from './ParticipationComparisonCard';
import {
  IconArrowRight,
  IconAward,
  IconBarChart,
  IconCalendar,
  IconClipboardCheck,
  IconHome,
  IconMoreHorizontal,
  IconStudentCourse,
  IconStudentFeedback,
  IconStudentReport,
  IconWallet
} from '../icons';
import { attendanceCounts, attendanceStatusLabel, reportCourse, studentDateLabel } from './studentPortalMetrics';
import type { StudentView } from './studentPortalTypes';
import type { ContactSchoolPreset } from './ContactSchoolModal';

const PROGRESS_DESCRIPTIONS: Partial<Record<StudentView, string>> = { accomplishments: 'Awards and milestones', feedback: 'Teacher notes shared with you', reports: 'Published progress summaries' };

interface Props {
  readonly user: AuthUser;
  readonly profile: Student | null;
  readonly history: StudentAttendanceHistoryEntry[];
  readonly benchmark: StudentAttendanceBenchmark | null;
  readonly reports: ProgressReport[];
  readonly accomplishments: Accomplishment[];
  readonly publishedReports: FeedbackSummary[];
  readonly studentReports: StudentReport[];
  readonly publishedReportsError: string;
  readonly paymentStatement: StudentPaymentStatement | null;
  readonly paymentError: string;
  readonly schedule: StudentSchedule | null;
  readonly scheduleError: string;
  readonly courses: string[];
  readonly errors: string[];
  readonly loading: boolean;
  readonly view: StudentView;
  readonly courseFilter: string;
  readonly onContactSchool: (preset?: ContactSchoolPreset) => void;
  readonly onOpenView: (view: StudentView, course?: string) => void;
  readonly onCourseChange: (course: string) => void;
  readonly onRetry: () => void;
  readonly onLogout: () => void;
}

const VIEW_META: Record<StudentView, { label: string; icon: React.ReactNode }> = {
  overview: { label: 'Home', icon: <IconHome /> },
  schedule: { label: 'Schedule', icon: <IconCalendar /> },
  attendance: { label: 'Attendance', icon: <IconClipboardCheck /> },
  payments: { label: 'Payments', icon: <IconWallet /> },
  feedback: { label: 'Feedback', icon: <IconStudentFeedback /> },
  accomplishments: { label: 'Achievements', icon: <IconAward /> },
  reports: { label: 'Reports', icon: <IconStudentReport /> }
};

const PRIMARY_VIEWS: StudentView[] = ['overview', 'schedule', 'attendance', 'payments'];

function accomplishmentCourse(item: Accomplishment): string {
  return item.classLabel.split(' · ')[0]?.trim() || item.classLabel;
}

function summaryCourse(item: FeedbackSummary): string {
  return item.classLabel.split(' · ')[0]?.trim() || item.classLabel;
}

function comparisonCopy(rate: number, marks: number, average: number | null | undefined) {
  if (!marks || average === null || average === undefined) {
    return { label: 'Building your baseline', detail: 'Your class comparison will appear after more attendance is recorded.', tone: 'neutral' };
  }
  const difference = rate - average;
  if (difference > 0) return { label: `${difference} points above average`, detail: 'You are building a strong attendance pattern.', tone: 'positive' };
  if (difference < 0) return { label: `${Math.abs(difference)} points below average`, detail: 'A few attended sessions can help close the gap.', tone: 'support' };
  return { label: 'Right on the class average', detail: 'Keep this steady rhythm going.', tone: 'steady' };
}

function comparisonFaceTone(tone: ReturnType<typeof comparisonCopy>['tone']): ComparisonTone {
  if (tone === 'positive') return 'ahead';
  if (tone === 'support') return 'behind';
  if (tone === 'steady') return 'aligned';
  return 'unavailable';
}

function MobileCourseSelect({ courses, value, onChange }: {
  readonly courses: readonly string[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="mobile-student-filter">
      <span>Class</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All classes</option>
        {courses.map((course) => <option value={course} key={course}>{course}</option>)}
      </select>
    </label>
  );
}

function MobileLoadingRows({ count = 3 }: { readonly count?: number }) {
  return (
    <div className="mobile-student-skeleton" aria-label="Loading content" aria-live="polite">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} aria-hidden="true"><i /><b /></span>
      ))}
    </div>
  );
}

function MobileHome({ user, profile, history, benchmark, reports, accomplishments, publishedReports, studentReports, paymentStatement, paymentError, courses, loading, onOpenView }: Pick<Props,
  'user' | 'profile' | 'history' | 'benchmark' | 'reports' | 'accomplishments' | 'publishedReports' | 'studentReports' | 'paymentStatement' | 'paymentError' | 'courses' | 'loading' | 'onOpenView'>) {
  const publishedCount = publishedReports.length + studentReports.length;
  let publishedCopy = 'Nothing published yet.';
  if (publishedCount > 0) publishedCopy = `${publishedCount} published report${publishedCount === 1 ? '' : 's'}`;
  const counts = useMemo(() => attendanceCounts(history), [history]);
  const comparison = comparisonCopy(counts.rate, counts.recorded, benchmark?.overallAverageRate);
  const firstName = (profile?.name ?? user.name).split(' ')[0] || user.name;
  const priorityAchievement = accomplishments.find((item) => !item.acknowledgedAt && !item.latestCorrection) ?? null;
  const latestFeedback = [...reports].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const paymentCopy = paymentSummaryCopy(
    paymentStatement?.amountDue ?? 0,
    paymentStatement?.currency ?? 'NZD',
    Boolean(paymentError)
  );

  return (
    <div className="mobile-student-screen mobile-student-home">
      <header className="mobile-student-home__intro">
        <h1>Hi, {firstName}.</h1>
        <p>Here is the part of your learning record that needs your attention today.</p>
      </header>

      {((paymentStatement?.amountDue ?? 0) > 0 || paymentError) && (
        <button type="button" className={`mobile-payment-priority${(paymentStatement?.amountDue ?? 0) > 0 ? ' has-balance' : ''}`} onClick={() => onOpenView('payments')}>
          <span><IconWallet /></span>
          <span><small>Student account</small><strong>{paymentCopy.title}</strong></span>
          <IconArrowRight />
        </button>
      )}

      <section className={`mobile-student-momentum is-${comparison.tone}`} aria-labelledby="mobile-momentum-title">
        <div className={`mobile-student-momentum__expression is-${comparison.tone}`}>
          <MomentumFace tone={comparisonFaceTone(comparison.tone)} />
        </div>
        <div className="mobile-student-momentum__copy">
          <span className="mobile-student-momentum__status"><IconBarChart /> Current pattern</span>
          <h2 id="mobile-momentum-title">{comparison.label}</h2>
          <p>{comparison.detail}</p>
        </div>
        <div className="mobile-student-momentum__lead">
          <span>participation</span>
          <strong>{counts.recorded ? `${counts.rate}%` : '—'}</strong>
        </div>
        <div className="mobile-student-momentum__bars" aria-label={`You ${counts.rate} percent, class average ${benchmark?.overallAverageRate ?? 'not available'} percent`}>
          <div><span><i style={{ width: `${counts.recorded ? counts.rate : 0}%` }} /></span><small>You</small><b>{counts.recorded ? `${counts.rate}%` : '—'}</b></div>
          <div><span><i style={{ width: `${benchmark?.overallAverageRate ?? 0}%` }} /></span><small>Average</small><b>{benchmark?.overallAverageRate === null || benchmark?.overallAverageRate === undefined ? '—' : `${benchmark.overallAverageRate}%`}</b></div>
        </div>
        <div className="mobile-student-momentum__footer">
          <small>{counts.recorded ? `Based on ${counts.recorded} recorded session${counts.recorded === 1 ? '' : 's'}` : 'Your comparison will appear after attendance is recorded.'}</small>
          <button type="button" onClick={() => onOpenView('attendance')}>View details <IconArrowRight /></button>
        </div>
      </section>

      {priorityAchievement && (
        <button type="button" className="mobile-student-priority" onClick={() => onOpenView('accomplishments')}>
          <span className="mobile-student-priority__icon"><IconAward /></span>
          <span>
            <small>Your response is needed</small>
            <strong>{priorityAchievement.title}</strong>
            <em>{accomplishmentCourse(priorityAchievement)} · {formatAccomplishmentPoints(priorityAchievement.points) || accomplishmentCategoryLabel(priorityAchievement.category)}</em>
          </span>
          <IconArrowRight />
        </button>
      )}

      <section className="mobile-student-section" aria-labelledby="mobile-classes-title">
        <div className="mobile-student-section__head">
          <div><h2 id="mobile-classes-title">Your classes</h2><p>Current and past course records. Open a class to see its attendance.</p></div>
          <span>{courses.length}</span>
        </div>
        <div className="mobile-student-course-rail">
          {loading && courses.length === 0 && <MobileLoadingRows count={2} />}
          {courses.map((course) => {
            const courseCounts = attendanceCounts(history.filter((row) => row.course === course));
            return (
              <button type="button" className="mobile-student-course-card" key={course} onClick={() => onOpenView('attendance', course)}>
                <span className="mobile-student-course-card__icon"><IconStudentCourse /></span>
                <strong>{course}</strong>
                <span>{courseCounts.total} session{courseCounts.total === 1 ? '' : 's'} in your record</span>
                <div><b>{courseCounts.recorded ? `${courseCounts.rate}%` : '—'}</b><small>{courseCounts.recorded ? 'participation' : 'not recorded'}</small></div>
                <em aria-hidden="true"><IconArrowRight /></em>
              </button>
            );
          })}
          {!loading && courses.length === 0 && <div className="mobile-student-empty-inline">No course records yet.</div>}
        </div>
      </section>

      <section className="mobile-student-section" aria-labelledby="mobile-updates-title">
        <div className="mobile-student-section__head">
          <div><h2 id="mobile-updates-title">Recent updates</h2><p>New information shared by your teachers.</p></div>
        </div>
        <div className="mobile-student-update-list">
          <button type="button" onClick={() => onOpenView('feedback')}>
            <span className="is-feedback"><IconStudentFeedback /></span>
            <span><strong>{latestFeedback ? reportCourse(latestFeedback) : 'Teacher feedback'}</strong><small>{latestFeedback ? latestFeedback.comment : 'No feedback has been shared yet.'}</small></span>
            <b>{reports.length}</b><IconArrowRight />
          </button>
          <button type="button" onClick={() => onOpenView('reports')}>
            <span className="is-report"><IconStudentReport /></span>
            <span><strong>Progress reports</strong><small>{publishedCopy}</small></span>
            <b>{publishedCount}</b><IconArrowRight />
          </button>
        </div>
      </section>
    </div>
  );
}

function MobileAttendance({ history, benchmark, courses, courseFilter, loading, onCourseChange }: Pick<Props,
  'history' | 'benchmark' | 'courses' | 'courseFilter' | 'loading' | 'onCourseChange'>) {
  const [visible, setVisible] = useState(6);
  const rows = useMemo(() => history
    .filter((row) => courseFilter === 'all' || row.course === courseFilter)
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate) || right.startTime.localeCompare(left.startTime)), [courseFilter, history]);
  const counts = attendanceCounts(rows);
  const average = courseFilter === 'all'
    ? benchmark?.overallAverageRate
    : benchmark?.courses.find((course) => course.course === courseFilter)?.averageRate;
  const comparison = comparisonCopy(counts.rate, counts.recorded, average);

  return (
    <div className="mobile-student-screen">
      <header className="mobile-student-page-title"><h1>Attendance</h1><p>See your current pattern and each recorded session.</p></header>
      <MobileCourseSelect courses={courses} value={courseFilter} onChange={(value) => { onCourseChange(value); setVisible(6); }} />

      <section className="mobile-attendance-hero">
        <div><strong>{counts.recorded ? `${counts.rate}%` : '—'}</strong><span>participation</span></div>
        <dl>
          <div><dt>Present</dt><dd className="is-present">{counts.Present}</dd></div>
          <div><dt>Late</dt><dd className="is-late">{counts.Late}</dd></div>
          <div><dt>Absent</dt><dd className="is-absent">{counts.Absent}</dd></div>
        </dl>
        <p>{comparison.label}. <span>{comparison.detail}</span></p>
      </section>

      <section className="mobile-student-section mobile-attendance-history" aria-labelledby="mobile-history-title">
        <div className="mobile-student-section__head"><div><h2 id="mobile-history-title">Session history</h2><p>Newest sessions appear first.</p></div><span>{rows.length}</span></div>
        <div className="mobile-attendance-timeline">
          {loading && rows.length === 0 && <MobileLoadingRows />}
          {rows.slice(0, visible).map((row) => (
            <article key={row.sessionId}>
              <span className={`mobile-attendance-timeline__dot is-${row.status.toLowerCase()}`} />
              <div className="mobile-attendance-timeline__main">
                <strong>{row.course}</strong>
                <span>{formatSessionDateLabel(row.sessionDate)} · {formatSessionTimeRange(row.startTime, row.endTime, row.sessionDate)}</span>
                <small>{sessionRoomLabel(row)}</small>
              </div>
              <div className="mobile-attendance-timeline__state">
                <span className={statusClass(row.status)}>{attendanceStatusLabel(row.status)}</span>
                <small>{row.checkInTime ? formatTimestampClock(row.checkInTime) : 'No check-in'}</small>
              </div>
            </article>
          ))}
          {!loading && rows.length === 0 && <div className="mobile-student-empty"><strong>No attendance yet</strong><span>Recorded sessions will appear here.</span></div>}
        </div>
        {visible < rows.length && <button className="mobile-student-load-more" type="button" onClick={() => setVisible((value) => value + 6)}>Show more sessions</button>}
      </section>
    </div>
  );
}

function MobileFeedback({ reports, courses, courseFilter, loading, onCourseChange }: Pick<Props,
  'reports' | 'courses' | 'courseFilter' | 'loading' | 'onCourseChange'>) {
  const [visible, setVisible] = useState(5);
  const rows = reports
    .filter((report) => courseFilter === 'all' || reportCourse(report) === courseFilter)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return (
    <div className="mobile-student-screen">
      <header className="mobile-student-page-title"><h1>Feedback</h1><p>Private progress notes shared by your teachers.</p></header>
      <MobileCourseSelect courses={courses} value={courseFilter} onChange={(value) => { onCourseChange(value); setVisible(5); }} />
      <p className="mobile-student-result-count">{rows.length} note{rows.length === 1 ? '' : 's'}</p>
      <section className="mobile-feedback-feed" aria-label="Teacher feedback">
        {loading && rows.length === 0 && <MobileLoadingRows />}
        {rows.slice(0, visible).map((report) => (
          <article key={report.id}>
            <div className={`person__avatar ${avatarTone(report.teacherId, 1)}`} aria-hidden="true">{initials(report.teacherName)}</div>
            <div className="mobile-feedback-feed__body">
              <div><strong>{report.teacherName}</strong><time>{studentDateLabel(report.createdAt)}</time></div>
              <span>{reportCourse(report)}</span>
              <p>{report.comment}</p>
              {report.photoUrl && <a href={report.photoUrl} target="_blank" rel="noreferrer"><img src={report.photoUrl} alt={`Attachment from ${report.teacherName}`} /><span>View attachment</span></a>}
            </div>
          </article>
        ))}
        {!loading && rows.length === 0 && <div className="mobile-student-empty"><strong>No feedback yet</strong><span>Your teacher's notes will appear here when shared.</span></div>}
      </section>
      {visible < rows.length && <button className="mobile-student-load-more" type="button" onClick={() => setVisible((value) => value + 5)}>Show more feedback</button>}
    </div>
  );
}

function MobileReports({ reports, studentReports, courses, courseFilter, loading, loadError, onCourseChange, onRetry }: {
  readonly reports: FeedbackSummary[];
  readonly studentReports: StudentReport[];
  readonly courses: string[];
  readonly courseFilter: string;
  readonly loading: boolean;
  readonly loadError: string;
  readonly onCourseChange: (course: string) => void;
  readonly onRetry: () => void;
}) {
  const rows = reports
    .filter((report) => courseFilter === 'all' || summaryCourse(report) === courseFilter)
    .sort((left, right) => (right.publishedAt ?? right.createdAt).localeCompare(left.publishedAt ?? left.createdAt));
  return (
    <div className="mobile-student-screen">
      <header className="mobile-student-page-title"><h1>Reports</h1><p>Teacher-reviewed summaries, ready when you need the full picture.</p></header>
      <MobileCourseSelect courses={courses} value={courseFilter} onChange={onCourseChange} />
      {loadError ? (
        <div className="mobile-student-empty is-warning"><strong>Reports are unavailable</strong><span>Try loading them again.</span><button type="button" onClick={onRetry}>Try again</button></div>
      ) : (
        <section className="mobile-report-stack" aria-label="Published reports">
          <PublishedStudentReports reports={studentReports} courseFilter={courseFilter} />
          {loading && rows.length === 0 && <MobileLoadingRows />}
          {rows.map((report, index) => (
            <details key={report.id} open={index === 0}>
              <summary>
                <span className="mobile-report-stack__icon"><IconStudentReport /></span>
                <span><strong>{summaryCourse(report)}</strong><small>{studentDateLabel(report.dateFrom)}–{studentDateLabel(report.dateTo)}</small></span>
                <IconArrowRight />
              </summary>
              <div className="mobile-report-stack__content">
                <section><span>Summary</span><p>{report.summary}</p></section>
                <section><span>Strengths</span><p>{report.strengths}</p></section>
                <section><span>Next steps</span><p>{report.nextSteps}</p></section>
                <small>Reviewed by {report.reviewedByTeacherName ?? report.createdByTeacherName}</small>
              </div>
            </details>
          ))}
          {!loading && rows.length === 0 && studentReports.length === 0 && <div className="mobile-student-empty"><strong>No published reports</strong><span>Teacher feedback remains available in the Feedback tab.</span></div>}
        </section>
      )}
    </div>
  );
}

function MobileAchievements({ accomplishments, studentId, courses, courseFilter, loading, onCourseChange, onRefresh }: {
  readonly accomplishments: Accomplishment[];
  readonly studentId: string;
  readonly courses: string[];
  readonly courseFilter: string;
  readonly loading: boolean;
  readonly onCourseChange: (course: string) => void;
  readonly onRefresh: () => void;
}) {
  const [category, setCategory] = useState('ALL');
  const [responseItem, setResponseItem] = useState<Accomplishment | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const rows = accomplishments.filter((item) =>
    (courseFilter === 'all' || accomplishmentCourse(item) === courseFilter)
    && (category === 'ALL' || item.category === category));
  const sortedRows = [...rows].sort((left, right) => {
    const leftNeedsResponse = !left.acknowledgedAt && !left.latestCorrection ? 1 : 0;
    const rightNeedsResponse = !right.acknowledgedAt && !right.latestCorrection ? 1 : 0;
    return rightNeedsResponse - leftNeedsResponse || right.achievementDate.localeCompare(left.achievementDate);
  });

  const acknowledge = async (item: Accomplishment) => {
    setBusyId(item.id); setError('');
    try {
      await acknowledgeAccomplishment(studentId, item.id);
      setNotice('You confirmed this achievement.');
      setResponseItem(null); onRefresh();
    } catch (caught) { setError(apiMessage(caught)); } finally { setBusyId(null); }
  };

  const submitCorrection = async (message: string) => {
    if (!responseItem) return;
    setBusyId(responseItem.id); setError('');
    try {
      await requestAccomplishmentCorrection(studentId, responseItem.id, message);
      setNotice('Your change request was sent.');
      setResponseItem(null); onRefresh();
    } catch (caught) { setError(apiMessage(caught)); } finally { setBusyId(null); }
  };

  return (
    <div className="mobile-student-screen">
      <header className="mobile-student-page-title"><h1>Achievements</h1><p>Completed work recognised by your teachers.</p></header>
      <div className="mobile-achievement-filters">
        <MobileCourseSelect courses={courses} value={courseFilter} onChange={onCourseChange} />
        <label className="mobile-student-filter"><span>Type</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">All types</option>{ACCOMPLISHMENT_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      {notice && <output className="mobile-student-notice">{notice}<button type="button" onClick={() => setNotice('')}>Dismiss</button></output>}
      <section className="mobile-achievement-list" aria-label="Achievements">
        {loading && sortedRows.length === 0 && <MobileLoadingRows />}
        {sortedRows.map((item) => {
          const needsResponse = !item.acknowledgedAt && !item.latestCorrection;
          return (
            <article className={needsResponse ? 'needs-response' : ''} key={item.id}>
              <div className="mobile-achievement-list__top">
                <span><IconAward /></span>
                <div><small>{accomplishmentCategoryLabel(item.category)}</small><h2>{item.title}</h2></div>
                {formatAccomplishmentPoints(item.points) && <b>{formatAccomplishmentPoints(item.points)}</b>}
              </div>
              {item.description && <p>{item.description}</p>}
              <div className="mobile-achievement-list__meta"><span>{accomplishmentCourse(item)}</span><time>{studentDateLabel(`${item.achievementDate}T00:00:00`)}</time></div>
              {needsResponse && <div className="mobile-achievement-list__attention"><strong>Check this record</strong><span>Confirm the details or ask your teacher to change them.</span></div>}
              {item.latestCorrection && <div className="mobile-achievement-list__response"><strong>{accomplishmentCorrectionLabel(item.latestCorrection.status)}</strong><span>{item.latestCorrection.status === 'PENDING' ? item.latestCorrection.message : item.latestCorrection.staffResponse || 'Review completed.'}</span></div>}
              {!item.latestCorrection && item.acknowledgedAt && <div className="mobile-achievement-list__confirmed">Details confirmed</div>}
              {item.latestCorrection?.status !== 'PENDING' && <button type="button" disabled={busyId === item.id} onClick={() => { setError(''); setResponseItem(item); }}>{needsResponse ? 'Review and respond' : 'View response'}<IconArrowRight /></button>}
            </article>
          );
        })}
        {!loading && sortedRows.length === 0 && <div className="mobile-student-empty"><strong>No achievements here</strong><span>Recognised work will appear here when a teacher shares it.</span></div>}
      </section>
      {responseItem && <RespondToAchievementModal accomplishment={responseItem} saving={busyId === responseItem.id} error={error} onClose={() => { setResponseItem(null); setError(''); }} onConfirm={() => void acknowledge(responseItem)} onSubmit={(message) => void submitCorrection(message)} />}
    </div>
  );
}

export default function MobileStudentPortal(props: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountDoneRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreDoneRef = useRef<HTMLButtonElement>(null);
  const { theme, setTheme } = useTheme();
  const displayName = props.profile?.name ?? props.user.name;
  const needsResponseCount = props.accomplishments.filter((item) => !item.acknowledgedAt && !item.latestCorrection).length;

  useEffect(() => {
    if (!accountOpen) return undefined;
    const focusTimer = window.setTimeout(() => accountDoneRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      accountButtonRef.current?.focus();
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const focusTimer = window.setTimeout(() => moreDoneRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      moreButtonRef.current?.focus();
    };
  }, [moreOpen]);

  return (
    <div className="mobile-student-portal">
      <a className="skip-link" href="#mobile-student-main">Skip to main content</a>
      <header className="mobile-student-topbar">
        <div className="mobile-student-brand"><span aria-hidden="true"><BrandMark /></span><div><strong>{BRAND_NAME}</strong><small>{VIEW_META[props.view].label}</small></div></div>
        <button
          type="button"
          className="mobile-student-contact-trigger"
          aria-label="Contact school"
          onClick={() => { setAccountOpen(false); setMoreOpen(false); props.onContactSchool(); }}
        >
          <IconStudentFeedback />
        </button>
        <button
          ref={accountButtonRef}
          type="button"
          className={`person__avatar ${avatarTone(props.user.id, 0)}`}
          aria-label="Open account menu"
          aria-expanded={accountOpen}
          aria-controls="mobile-student-account-sheet"
          onClick={() => { setMoreOpen(false); setAccountOpen(true); }}
        >
          {initials(displayName)}
        </button>
      </header>

      <main id="mobile-student-main" className="mobile-student-main" tabIndex={-1}>
        {props.errors.length > 0 && <output className="mobile-student-data-warning"><span>Some information did not load.</span><button type="button" disabled={props.loading} onClick={props.onRetry}>{props.loading ? 'Retrying…' : 'Try again'}</button></output>}
        {props.view === 'overview' && <><MobileHome {...props} /><ConsentPanel studentId={props.user.id} /><StudentCheckInPanel key={props.user.id} studentId={props.user.id} /><WebcamEventsEntry key={`webcam-${props.user.id}`} studentId={props.user.id} /></>}
        {props.view === 'attendance' && <MobileAttendance {...props} />}
        {props.view === 'schedule' && <StudentScheduleView schedule={props.schedule} loading={props.loading} loadError={props.scheduleError} onRetry={props.onRetry} onRequestLeave={(session) => props.onContactSchool({ type: 'LEAVE', sessionId: session.id })} />}
        {props.view === 'feedback' && <MobileFeedback {...props} />}
        {props.view === 'reports' && <MobileReports reports={props.publishedReports} studentReports={props.studentReports} courses={props.courses} courseFilter={props.courseFilter} loading={props.loading} loadError={props.publishedReportsError} onCourseChange={props.onCourseChange} onRetry={props.onRetry} />}
        {props.view === 'payments' && <StudentPaymentsView studentId={props.profile?.recordId ?? props.user.id} statement={props.paymentStatement} loading={props.loading} loadError={props.paymentError} onRefresh={props.onRetry} mobile />}
        {props.view === 'accomplishments' && <MobileAchievements accomplishments={props.accomplishments} studentId={props.profile?.recordId ?? props.user.id} courses={props.courses} courseFilter={props.courseFilter} loading={props.loading} onCourseChange={props.onCourseChange} onRefresh={props.onRetry} />}
      </main>

      <nav className="mobile-student-tabs" aria-label="Student portal">
        {PRIMARY_VIEWS.map((item) => (
          <button type="button" className={props.view === item ? 'is-active' : ''} aria-current={props.view === item ? 'page' : undefined} key={item} onClick={() => props.onOpenView(item)}>
            <span className="mobile-student-tabs__icon">
              {VIEW_META[item].icon}
              {item === 'accomplishments' && needsResponseCount > 0 && (
                <b aria-label={`${needsResponseCount} achievement${needsResponseCount === 1 ? '' : 's'} need your response`}>{needsResponseCount}</b>
              )}
            </span>
            <span>{VIEW_META[item].label}</span>
          </button>
        ))}
        <button ref={moreButtonRef} type="button" className={props.view === 'feedback' || props.view === 'reports' || props.view === 'accomplishments' ? 'is-active' : ''} aria-current={props.view === 'feedback' || props.view === 'reports' || props.view === 'accomplishments' ? 'page' : undefined} aria-expanded={moreOpen} aria-controls="mobile-student-more-sheet" onClick={() => { setAccountOpen(false); setMoreOpen(true); }}>
          <span className="mobile-student-tabs__icon"><IconMoreHorizontal /></span>
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="mobile-student-sheet-scrim">
          <button type="button" className="mobile-student-sheet-backdrop" tabIndex={-1} onClick={() => setMoreOpen(false)} aria-label="Close more menu" />
          <dialog open id="mobile-student-more-sheet" className="mobile-student-nav-sheet" aria-modal="true" aria-labelledby="mobile-student-more-title">
            <div className="mobile-student-account-sheet__handle" />
            <div className="mobile-student-account-sheet__head"><strong id="mobile-student-more-title">More</strong><button ref={moreDoneRef} type="button" onClick={() => setMoreOpen(false)}>Done</button></div>
            <div className="mobile-student-nav-sheet__list">
              {(['accomplishments', 'feedback', 'reports'] as StudentView[]).map((item) => <button type="button" key={item} onClick={() => { props.onOpenView(item); setMoreOpen(false); }}><span>{VIEW_META[item].icon}</span><span><strong>{VIEW_META[item].label}</strong><small>{PROGRESS_DESCRIPTIONS[item]}</small></span><IconArrowRight /></button>)}
            </div>
          </dialog>
        </div>
      )}

      {accountOpen && (
        <div className="mobile-student-sheet-scrim">
          <button type="button" className="mobile-student-sheet-backdrop" tabIndex={-1} onClick={() => setAccountOpen(false)} aria-label="Close account menu" />
          <dialog open id="mobile-student-account-sheet" className="mobile-student-account-sheet" aria-modal="true" aria-labelledby="mobile-account-title">
            <div className="mobile-student-account-sheet__handle" />
            <div className="mobile-student-account-sheet__head"><strong>Account</strong><button ref={accountDoneRef} type="button" onClick={() => setAccountOpen(false)}>Done</button></div>
            <div className="mobile-student-account-sheet__person"><div className={`person__avatar ${avatarTone(props.user.id, 0)}`}>{initials(displayName)}</div><div><h2 id="mobile-account-title">{displayName}</h2><p>{props.profile?.studentNumber ?? props.user.email}</p></div></div>
            <div className="mobile-student-account-sheet__details"><div><span>Programme</span><strong>{props.profile?.program ?? '—'}</strong></div><div><span>Email</span><strong>{props.profile?.email ?? props.user.email}</strong></div></div>
            <div className="mobile-student-account-sheet__actions"><button type="button" className="mobile-student-contact-school" onClick={() => { setAccountOpen(false); props.onContactSchool(); }}><IconStudentFeedback /><span><strong>Contact school</strong><small>Send a question or request</small></span><IconArrowRight /></button><div><span>Appearance</span><ThemeToggleButton theme={theme} onToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} /></div><button type="button" onClick={props.onLogout}>Sign out</button></div>
          </dialog>
        </div>
      )}
    </div>
  );
}
