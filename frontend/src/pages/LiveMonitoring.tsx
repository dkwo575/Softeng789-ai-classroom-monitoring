import { TeacherLiveVideo } from '../features/live-video';
import TeacherObservationsPanel from '../features/webcam-events/TeacherObservationsPanel';
import { useMemo, useState } from 'react';
import BackButton from '../components/BackButton';
import { IconMonitor } from '../components/icons';
import SearchField from '../components/SearchField';
import { sessionRoomLabel } from '../lib/classroomApi';
import { sessionDisplayName } from '../lib/eventDisplay';
import { statusClass } from '../lib/format';
import { studentIsEnrolledInSession } from '../lib/studentCourses';
import type { Console } from '../hooks/useConsole';
import type { Session, Student } from '../types';

export default function LiveMonitoring({ console: c }: { readonly console: Console }) {
  // Every visit starts at the picker rather than remembering the last classroom — with many
  // teachers/classes in the system, jumping straight into whatever session happened to be active
  // elsewhere stopped being a sensible default.
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);

  if (!viewingSessionId) {
    return (
      <LiveMonitoringPicker
        sessions={c.sessions}
        students={c.students}
        onSelect={(id) => {
          c.selectSession(id);
          setViewingSessionId(id);
        }}
      />
    );
  }

  return (
    <div className="page__inner">
      <BackButton label="Back to classrooms" onClick={() => setViewingSessionId(null)} className="page-action" />
      <h1>{sessionDisplayName(c.activeSession)}</h1>
      <p>{c.activeSession.dateLabel} · {c.activeSession.time} · {sessionRoomLabel(c.activeSession)}</p>
      {c.activeSession.recordId
        ? <><TeacherLiveVideo key={`video-${c.activeSession.recordId}`} sessionId={c.activeSession.recordId} /><TeacherObservationsPanel key={c.activeSession.recordId} sessionId={c.activeSession.recordId} /></>
        : <p>Choose a saved classroom session to view shared observations.</p>}
    </div>
  );
}
function LiveMonitoringPicker({
  sessions,
  students,
  onSelect
}: {
  readonly sessions: readonly Session[];
  readonly students: readonly Student[];
  readonly onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) => matchesQuery(session, trimmed, students));
  }, [sessions, students, query]);

  return (
    <div className="page__inner">
      <section className="card dashboard-enter stagger-0">
        <div className="card__head">
          <div className="card__title-row">
            <span className="icon-inline icon-inline--title" aria-hidden="true">
              <IconMonitor />
            </span>
            <div>
              <div className="card__title">Choose a classroom to monitor</div>
              <div className="card__sub">
                Search by room, course, teacher or student, then pick one to open its live view.
              </div>
            </div>
          </div>
        </div>

        {sessions.length === 0 ? (
          <div className="empty">No classroom sessions have been scheduled yet.</div>
        ) : (
          <>
            <SearchField
              className="card-list-search"
              value={query}
              onChange={setQuery}
              placeholder="Room, course, teacher or student"
              autoFocus
            />

            <div className="live-picker-list">
              {matches.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="live-picker-item"
                  onClick={() => onSelect(session.id)}
                >
                  <div>
                    <div className="cell-strong">{session.course}</div>
                    <div className="cell-sub">
                      {sessionRoomLabel(session)} · {session.teacherName ?? 'Unassigned Teacher'} · {session.dateLabel}
                    </div>
                  </div>
                  <span className={statusClass(session.status)}>{session.status}</span>
                </button>
              ))}
              {matches.length === 0 && (
                <div className="live-picker-empty">
                  <strong>No matching classrooms</strong>
                  <span>Try another room, course, teacher or student.</span>
                  <button type="button" className="btn btn--sm" onClick={() => setQuery('')}>Clear search</button>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function matchesQuery(session: Session, query: string, students: readonly Student[]): boolean {
  if (
    session.room.toLowerCase().includes(query) ||
    session.course.toLowerCase().includes(query) ||
    (session.teacherName ?? '').toLowerCase().includes(query)
  ) {
    return true;
  }
  return students.some(
    (student) =>
      student.name.toLowerCase().includes(query) && studentIsEnrolledInSession(student, session)
  );
}
