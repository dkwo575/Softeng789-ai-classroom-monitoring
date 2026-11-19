import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconUserPlus } from '../components/icons';
import Modal from '../components/Modal';
import { GuardianReview, useSignupReviews, registrationReadiness, checkingSignup } from '../features/student-signup';
import RegistrationReview from '../components/auth/RegistrationReview';
import Pager from '../components/Pager';
import PersonAvatar from '../components/PersonAvatar';
import SearchField from '../components/SearchField';
import SelectMenu from '../components/SelectMenu';
import SortableHeader from '../components/SortableHeader';
import { apiMessage } from '../lib/apiClient';
import { avatarTone, formatDateTime, statusClass } from '../lib/format';
import { approveStudent, listPendingStudents, rejectStudent, type PendingStudentApiResponse } from '../lib/studentApi';
import { sortRows, usePagination, useSort } from '../lib/table';

const PAGE_SIZE = 8;
const ALL_STATES = 'All states';
const READY = 'Ready to approve';
const NEEDS_ATTENTION = 'Needs attention';

type RegistrationSortKey = 'student' | 'classes' | 'face' | 'consent' | 'submitted';
type RegistrationAction = 'approve' | 'reject';

export default function AdminRegistrations() {
  const [guardianStudentId, setGuardianStudentId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingStudentApiResponse[]>([]);
  const [signupRevision, setSignupRevision] = useState(0);
  const signupStatuses = useSignupReviews(pending.map(student => student.id), signupRevision);
  const isReadyToApprove = useCallback((student: PendingStudentApiResponse) =>
    registrationReadiness(student, signupStatuses[student.id]).ready, [signupStatuses]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState<{ id: string; action: RegistrationAction } | null>(null);
  const [actionError, setActionError] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<PendingStudentApiResponse | null>(null);
  const [query, setQuery] = useState('');
  const [reviewState, setReviewState] = useState(ALL_STATES);
  const [page, setPage] = useState(0);
  const [expandedClassIds, setExpandedClassIds] = useState<Set<string>>(() => new Set());
  const { sort, toggle } = useSort<RegistrationSortKey>('submitted', -1);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listPendingStudents();
      setPending(result);
      setSignupRevision(value => value + 1);
      setListError('');
    } catch (error) {
      setListError(apiMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = async (id: string) => {
    setActionError('');
    setBusy({ id, action: 'approve' });
    try {
      await approveStudent(id, true);
      setReviewing(null);
      setPending((current) => current.filter((student) => student.id !== id));
    } catch (error) {
      setActionError(apiMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    setActionError('');
    setBusy({ id, action: 'reject' });
    try {
      await rejectStudent(id);
      setPending((current) => current.filter((student) => student.id !== id));
      setConfirmingId(null);
    } catch (error) {
      setActionError(apiMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const readyCount = useMemo(() => pending.filter(isReadyToApprove).length, [pending, isReadyToApprove]);
  const attentionCount = pending.length - readyCount;
  const queueLoading = loading && pending.length === 0;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return pending.filter((student) => {
      const ready = isReadyToApprove(student);
      if (reviewState === READY && !ready) return false;
      if (reviewState === NEEDS_ATTENTION && ready) return false;
      if (!normalized) return true;
      return [
        student.fullName,
        student.studentNumber,
        student.universityEmail,
        ...student.requestedClasses
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [pending, query, reviewState, isReadyToApprove]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, (student, key) => {
        if (key === 'student') return student.fullName.toLowerCase();
        if (key === 'classes') return student.requestedClasses.join(' ').toLowerCase();
        if (key === 'face') {
          if (student.faceEnrollmentStatus === 'VERIFIED') return 0;
          return student.faceEnrollmentStatus === 'NOT_ENROLLED' ? 1 : 2;
        }
        if (key === 'consent') return student.consentGiven ? 0 : 1;
        return student.createdAt;
      }),
    [filtered, sort]
  );
  const paged = usePagination(sorted, page, setPage, PAGE_SIZE);
  const confirmingStudent = pending.find((student) => student.id === confirmingId) ?? null;

  return (
    <div className="page__inner registrations-page">
      <section className="card registrations-card dashboard-enter stagger-1">
        <div className="card__head">
          <div className="card__title-row">
            <span className="icon-inline icon-inline--title" aria-hidden="true">
              <IconUserPlus />
            </span>
            <div>
              <div className="card__title">Approval queue</div>
              <div className="card__sub">
                Verify enrolment requirements and requested classes before activating an account.
              </div>
            </div>
          </div>
          <div className="registration-review-summary" aria-label="Registration review status" aria-live="polite">
            <div className="registration-review-summary__total">
              <strong>{queueLoading ? '—' : pending.length}</strong>
              <span>{queueLoading ? 'Loading queue…' : 'Awaiting review'}</span>
            </div>
            {!queueLoading && <div className="registration-review-summary__states">
              {readyCount > 0 && (
                <span className="registration-review-summary__ready">
                  <i aria-hidden="true" /> <strong>{readyCount}</strong> ready to approve
                </span>
              )}
              {attentionCount > 0 && (
                <span className="registration-review-summary__attention">
                  <i aria-hidden="true" /> <strong>{attentionCount}</strong>{' '}
                  {attentionCount === 1 ? 'needs' : 'need'} attention
                </span>
              )}
              {pending.length === 0 && (
                <span className="registration-review-summary__ready">
                  <i aria-hidden="true" /> Queue clear
                </span>
              )}
            </div>}
          </div>
        </div>

        <div className="list-toolbar registrations-toolbar" role="search" aria-label="Filter registrations">
          <SearchField
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
            label="Search requests"
            placeholder="Search name, ID, email or course"
          />
          <div className="field">
            <span>Review status</span>
            <SelectMenu
              value={reviewState}
              options={[ALL_STATES, READY, NEEDS_ATTENTION].map((value) => ({ value, label: value }))}
              ariaLabel="Filter registrations by review status"
              onChange={(value) => {
                setReviewState(value);
                setPage(0);
              }}
            />
          </div>
          <button type="button" className="btn btn--sm" disabled={loading || busy !== null} onClick={() => void refresh()}>Refresh queue</button>
          <div className="registrations-toolbar__result" aria-live="polite">
            {queueLoading ? (
              'Loading requests…'
            ) : (
              <><strong>{filtered.length}</strong> {filtered.length === 1 ? 'request' : 'requests'} shown</>
            )}
          </div>
        </div>

        {listError && (
          <div className="notice notice--warn" role="alert">
            <span className="notice__mark" aria-hidden="true" />
            <span>{listError}</span>
            <span className="spacer" />
            <button type="button" className="btn btn--sm" onClick={() => void refresh()}>Retry</button>
          </div>
        )}

        {actionError && (
          <div className="notice notice--warn" role="alert">
            <span className="notice__mark" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
        )}

        {(loading || sorted.length > 0) && (
          <section className="registrations-table-wrap"  tabIndex={0} aria-label="Registration requests table">
            <table className="table table--compact table--fixed-cols registrations-table">
              <SortableHeader
                columns={[
                  { key: 'student', label: 'Student', width: '27%' },
                  { key: 'classes', label: 'Requested classes', width: '21%' },
                  { key: 'face', label: 'Face enrolment', width: '14%' },
                  { key: 'consent', label: 'Consent', width: '11%' },
                  { key: 'submitted', label: 'Submitted', priority: true, width: '13%' }
                ]}
                sort={sort}
                onSort={(key) => {
                  toggle(key);
                  setPage(0);
                }}
              />
              <tbody>
                {paged.rows.map((student, index) => {
                  const signup = signupStatuses[student.id] ?? checkingSignup;
                  const readiness = registrationReadiness(student, signup);
                  const ready = readiness.ready;
                  const classesExpanded = expandedClassIds.has(student.id);
                  const visibleClasses = classesExpanded
                    ? student.requestedClasses
                    : student.requestedClasses.slice(0, 2);
                  return (
                    <tr
                      key={student.id}
                      className={ready ? 'registration-row registration-row--ready' : 'registration-row'}
                      aria-busy={busy?.id === student.id}
                    >
                      <td data-label="">
                        <div className="person">
                          <PersonAvatar
                            name={student.fullName}
                            tone={avatarTone(student.id, index)}
                            alt={`${student.fullName} registration`}
                          />
                          <div className="registration-student">
                            <div className="cell-strong">{student.fullName}</div>
                            <div className="cell-sub">{student.studentNumber} · {student.universityEmail}</div>
                            <span className={ready ? 'registration-readiness registration-readiness--ready' : 'registration-readiness registration-readiness--attention'}>
                              <i aria-hidden="true" />
                              <span className="registration-readiness__text">{readiness.label}</span>
                            </span>
                            {signup.label !== readiness.label && <div className="cell-sub registration-guardian-status">{signup.label}</div>}
                          </div>
                        </div>
                      </td>
                      <td data-label="Requested classes">
                        {student.requestedClasses.length > 0 ? (
                          <div className="registration-class-list">
                            {visibleClasses.map((className) => <span key={className}>{className}</span>)}
                            {student.requestedClasses.length > 2 && (
                              <button
                                type="button"
                                className="registration-class-toggle"
                                aria-expanded={classesExpanded}
                                onClick={() => {
                                  setExpandedClassIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(student.id)) next.delete(student.id);
                                    else next.add(student.id);
                                    return next;
                                  });
                                }}
                              >
                                {classesExpanded ? 'Show less' : `+${student.requestedClasses.length - 2} more`}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="cell-sub">No classes requested</span>
                        )}
                      </td>
                      <td data-label="Face enrolment">
                        <span className={statusClass(student.faceEnrollmentStatus)}>
                          {student.attendanceMode === 'FACE' ? '7 captures submitted' : 'Manual attendance'}
                        </span>
                      </td>
                      <td data-label="Consent">
                        <span className={`badge ${student.consentGiven ? 'badge--present' : 'badge--absent'}`}>
                          {student.attendanceMode === 'FACE' ? 'Given' : 'Not required'}
                        </span>
                      </td>
                      <td data-label="Submitted">
                        <span className="registration-submitted">{formatDateTime(student.createdAt)}</span>
                      </td>
                      <td className="table__action-cell" data-label="">
                        <span className="table__action-group registration-actions">
                          <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                            onClick={() => setGuardianStudentId(student.id)}>Guardian details</button>
                          <button
                            type="button"
                            className="btn btn--quiet btn--sm"
                            aria-label={`Reject ${student.fullName}'s registration`}
                            disabled={busy?.id === student.id}
                            onClick={() => setConfirmingId(student.id)}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            aria-label={`Approve ${student.fullName}'s registration`}
                            title={readiness.label}
                            disabled={busy !== null}
                            onClick={() => { setActionError(''); setReviewing(student); }}
                          >
                            Review
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {loading && pending.length === 0 && (
                  <tr><td colSpan={6}><output className="empty empty--inline">Loading registrations…</output></td></tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {!loading && filtered.length === 0 && !listError && (
          <div className="empty registrations-empty">
            <span className="registrations-empty__icon" aria-hidden="true"><IconUserPlus /></span>
            <strong>
              {pending.length === 0 ? 'The approval queue is clear' : 'No matching registrations'}
            </strong>
            <p>
              {pending.length === 0
                ? 'New student registration requests will appear here.'
                : 'Try a different search or reset the review status.'}
            </p>
            {pending.length > 0 && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setQuery('');
                  setReviewState(ALL_STATES);
                  setPage(0);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {sorted.length > 0 && (
          <Pager
            label={paged.label}
            page={paged.page}
            pageCount={paged.pageCount}
            canPrev={paged.canPrev}
            canNext={paged.canNext}
            onPrev={paged.prev}
            onNext={paged.next}
            onGoToPage={paged.goToPage}
          />
        )}
      </section>

      {guardianStudentId && <GuardianReview key={guardianStudentId} studentId={guardianStudentId} onClose={() => { setGuardianStudentId(null); setSignupRevision(value => value + 1); }} />}
      {reviewing && <RegistrationReview key={reviewing.id} student={reviewing} busy={busy !== null} error={actionError}
        onClose={() => { setReviewing(null); setActionError(''); }} onApprove={() => void approve(reviewing.id)} />}
      {confirmingStudent && (
        <Modal
          onClose={() => {
            if (busy?.id !== confirmingStudent.id) setConfirmingId(null);
          }}
          size="confirm"
          role="alertdialog"
          titleId="reject-registration-title"
          title="Reject this registration?"
          subtitle={`${confirmingStudent.fullName} will see a rejected registration and must contact an administrator. Pending review photos will be deleted.`}
          footer={
            <>
              <button
                type="button"
                className="btn"
                disabled={busy?.id === confirmingStudent.id}
                onClick={() => setConfirmingId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy?.id === confirmingStudent.id}
                onClick={() => void reject(confirmingStudent.id)}
              >
                {busy?.id === confirmingStudent.id && busy.action === 'reject' ? 'Rejecting…' : 'Reject registration'}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}
