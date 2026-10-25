import { useMemo, useState } from 'react';
import { ConsentPanel, StudentCheckInPanel } from '../features/photo-attendance';
import { WebcamEventsEntry } from '../features/webcam-events';
import StudentAttendanceView from '../components/student/StudentAttendanceView';
import StudentAccomplishmentsView from '../components/student/StudentAccomplishmentsView';
import StudentFeedbackView from '../components/student/StudentFeedbackView';
import MobileStudentPortal from '../components/student/MobileStudentPortal';
import StudentOverviewView from '../components/student/StudentOverviewView';
import StudentPortalHeader from '../components/student/StudentPortalHeader';
import ContactSchoolModal, { type ContactSchoolPreset } from '../components/student/ContactSchoolModal';
import StudentReportsView from '../components/student/StudentReportsView';
import StudentScheduleView from '../components/student/StudentScheduleView';
import { StudentPaymentsView } from '../features/payments';
import { reportCourse } from '../components/student/studentPortalMetrics';
import type { StudentView } from '../components/student/studentPortalTypes';
import { useStudentPortalData } from '../hooks/useStudentPortalData';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { AuthUser } from '../types';

interface Props {
  readonly user: AuthUser;
  readonly onLogout: () => void;
}

export default function StudentPortal({ user, onLogout }: Props) {
  const isMobile = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<StudentView>('overview');
  const [courseFilter, setCourseFilter] = useState('all');
  const [contactPreset, setContactPreset] = useState<ContactSchoolPreset | null>(null);
  const {
    profile,
    history,
    benchmark,
    reports,
    accomplishments,
    publishedReports,
    studentReports,
    publishedReportsError,
    paymentStatement,
    paymentError,
    schedule,
    scheduleError,
    errors,
    loading,
    retry
  } = useStudentPortalData(user);

  const courses = useMemo(() => {
    const values = new Set(profile?.courses ?? (profile?.course ? [profile.course] : []));
    history.forEach((row) => values.add(row.course));
    reports.forEach((report) => values.add(reportCourse(report)));
    accomplishments.forEach((item) => {
      values.add(item.classLabel.split(' · ')[0]?.trim() || item.classLabel);
    });
    publishedReports.forEach((report) => {
      values.add(report.classLabel.split(' · ')[0]?.trim() || report.classLabel);
    });
    studentReports.forEach((report) => report.document.courseLabels.forEach((label) => values.add(label.split(' · ')[0] || label)));
    return Array.from(values).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }, [accomplishments, history, profile, publishedReports, reports, studentReports]);

  const openView = (nextView: StudentView, course = 'all') => {
    setCourseFilter(course);
    setView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isMobile) {
    return (
      <>
        <MobileStudentPortal
          user={user}
          profile={profile}
          history={history}
          benchmark={benchmark}
          reports={reports}
          accomplishments={accomplishments}
          publishedReports={publishedReports}
          studentReports={studentReports}
          publishedReportsError={publishedReportsError}
          paymentStatement={paymentStatement}
          paymentError={paymentError}
          schedule={schedule}
          scheduleError={scheduleError}
          courses={courses}
          errors={errors}
          loading={loading}
          view={view}
          courseFilter={courseFilter}
          onContactSchool={(preset) => setContactPreset(preset ?? {})}
          onOpenView={openView}
          onCourseChange={setCourseFilter}
          onRetry={retry}
          onLogout={onLogout}
        />
        {contactPreset && <ContactSchoolModal user={user} profile={profile} schedule={schedule} preset={contactPreset} onClose={() => setContactPreset(null)} onSubmitted={retry} />}
      </>
    );
  }

  return (
    <div className="student-portal">
      <a className="skip-link" href="#student-main">Skip to main content</a>

      <StudentPortalHeader
        user={user}
        profile={profile}
        view={view}
        feedbackCount={reports.length}
        accomplishmentCount={accomplishments.length}
        reportCount={publishedReports.length + studentReports.length}
        amountDue={paymentStatement?.amountDue ?? 0}
        onContactSchool={() => setContactPreset({})}
        onOpenView={openView}
        onLogout={onLogout}
      />

      <main className="student-portal__page" id="student-main" tabIndex={-1}>
        <div className="student-portal__inner">
          {view === 'overview' && <><ConsentPanel studentId={user.id} /><StudentCheckInPanel key={user.id} studentId={user.id} /><WebcamEventsEntry key={`webcam-${user.id}`} studentId={user.id} /></>}
          {errors.length > 0 && (
            <output className="notice notice--warn student-data-notice">
              <span className="notice__mark" aria-hidden="true" />
              <span className="student-data-notice__message">
                Some information could not be loaded. The information that is available is still shown below.
              </span>
              <button type="button" className="btn btn--sm" disabled={loading} onClick={retry}>
                {loading ? 'Retrying…' : 'Try again'}
              </button>
            </output>
          )}

          {view === 'overview' && (
            <StudentOverviewView
              user={user}
              profile={profile}
              history={history}
              benchmark={benchmark}
              reports={reports}
              accomplishments={accomplishments}
              publishedReportCount={publishedReports.length + studentReports.length}
              amountDue={paymentStatement?.amountDue ?? 0}
              paymentCurrency={paymentStatement?.currency ?? 'NZD'}
              paymentUnavailable={Boolean(paymentError)}
              courses={courses}
              loading={loading}
              onOpenView={openView}
            />
          )}

          {view === 'attendance' && (
            <StudentAttendanceView
              history={history}
              benchmark={benchmark}
              courses={courses}
              courseFilter={courseFilter}
              loading={loading}
              onCourseChange={setCourseFilter}
            />
          )}

          {view === 'schedule' && (
            <StudentScheduleView
              schedule={schedule}
              loading={loading}
              loadError={scheduleError}
              onRetry={retry}
              onRequestLeave={(session) => setContactPreset({ type: 'LEAVE', sessionId: session.id })}
            />
          )}

          {view === 'feedback' && (
            <StudentFeedbackView
              reports={reports}
              courses={courses}
              courseFilter={courseFilter}
              loading={loading}
              onCourseChange={setCourseFilter}
            />
          )}

          {view === 'accomplishments' && (
            <StudentAccomplishmentsView
              accomplishments={accomplishments}
              studentId={profile?.recordId ?? user.id}
              courses={courses}
              courseFilter={courseFilter}
              loading={loading}
              onCourseChange={setCourseFilter}
              onRefresh={retry}
            />
          )}

          {view === 'reports' && (
            <StudentReportsView
              reports={publishedReports}
              studentReports={studentReports}
              courses={courses}
              courseFilter={courseFilter}
              loading={loading}
              loadError={publishedReportsError}
              onCourseChange={setCourseFilter}
              onRetry={retry}
            />
          )}

          {view === 'payments' && (
            <StudentPaymentsView
              studentId={profile?.recordId ?? user.id}
              statement={paymentStatement}
              loading={loading}
              loadError={paymentError}
              onRefresh={retry}
            />
          )}
        </div>
      </main>
      {contactPreset && <ContactSchoolModal user={user} profile={profile} schedule={schedule} preset={contactPreset} onClose={() => setContactPreset(null)} onSubmitted={retry} />}
    </div>
  );
}
