import { Fragment, useState } from 'react';
import type { SharingDashboard } from './sharingApi';

type Filter = 'all' | 'connected' | 'paused' | 'checks';
const states: Record<string, string> = {
  RUNNING: 'Connected', STARTING: 'Starting', PAUSED: 'Analysis paused',
  STOPPED: 'Camera off', DISCONNECTED: 'Connection lost', SESSION_CLOSED: 'Session closed'
};
const PAGE_SIZE = 20;

export default function ObservationRoster({ students, stale, query, onQuery }: {
  students: SharingDashboard['students']; stale: boolean; query: string; onQuery: (value: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const connected = students.filter(s => ['RUNNING', 'PAUSED'].includes(s.connection?.state ?? '')).length;
  const paused = students.filter(s => s.connection?.state === 'PAUSED').length;
  const checks = students.filter(s => s.summary.pendingChecks > 0).length;
  const filtered = students.filter(s => s.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (
    filter === 'all' || filter === 'checks' && s.summary.pendingChecks > 0 ||
    !stale && (filter === 'connected' && ['RUNNING', 'PAUSED'].includes(s.connection?.state ?? '') || filter === 'paused' && s.connection?.state === 'PAUSED')
  )).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const tiles: { key: Filter; label: string; count: number | string; disabled?: boolean }[] = [
    { key: 'all', label: 'All students', count: students.length },
    { key: 'connected', label: 'Connected', count: stale ? '—' : connected, disabled: stale },
    { key: 'paused', label: 'Analysis paused', count: stale ? '—' : paused, disabled: stale },
    { key: 'checks', label: 'With optional checks', count: checks }
  ];
  return <div className="observation-roster">
    <div className="observation-roster__totals" aria-label="Class overview filters">
      {tiles.map(t => <button key={t.key} type="button" disabled={t.disabled} aria-pressed={filter === t.key}
        onClick={() => { setFilter(t.key); setPage(0); }}><strong>{t.count}</strong><span>{t.label}</span></button>)}
    </div>
    <div className="observation-roster__toolbar">
      <label>Search students<input className="webcam-events__search" type="search" value={query}
        onChange={e => { onQuery(e.target.value); setPage(0); }} placeholder="Student name" /></label>
      <span role="status">{filtered.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)}` : '0'} of {filtered.length} students</span>
    </div>
    {stale && <p>Connection status is unknown until refresh succeeds. Report counts are from the last received update.</p>}
    <div className="observation-roster__table-wrap">
      <table className="observation-roster__table">
        <caption className="observation-roster__caption">Student overview · alphabetical order</caption>
        <thead><tr><th scope="col">Student</th><th scope="col">Connection</th><th scope="col">Checks</th><th scope="col">Details</th></tr></thead>
        <tbody>{visible.map(s => <Fragment key={s.id}>
          <tr>
            <th scope="row">{s.name}</th>
            <td><span className={`observation-roster__status ${!stale && s.connection?.state === 'RUNNING' ? 'is-connected' : ''}`}>{stale ? 'Unknown' : s.connection ? states[s.connection.state] ?? 'Unknown' : 'Not sharing'}</span></td>
            <td><span className={s.summary.pendingChecks ? 'observation-roster__count' : ''}>{s.summary.pendingChecks}</span></td>
            <td><button className="observation-roster__expand" type="button" aria-expanded={expanded === s.id}
              aria-controls={`observation-detail-${s.id}`} aria-label={`${expanded === s.id ? 'Hide' : 'Show'} details for ${s.name}`}
              onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? '−' : '+'}</button></td>
          </tr>
          {expanded === s.id && <tr id={`observation-detail-${s.id}`} className="observation-roster__detail"><td colSpan={4}>
            <strong>{s.name} · retained reports</strong>
            <p>Head movement {s.summary.headMovements} · No face {s.summary.noFaceReports} · Multiple faces {s.summary.multipleFaceReports}</p>
            {s.connection && <small>Last heartbeat: {new Date(s.connection.lastHeartbeat).toLocaleTimeString()}. </small>}
            <small>Counts cover up to 24 hours. Analysis paused means samples are unavailable; it is not absence or an attention rating.</small>
          </td></tr>}
        </Fragment>)}</tbody>
      </table>
      {!visible.length && <p>No students match this search and filter.{stale && filter !== 'all' && filter !== 'checks' ? ' Select All students to see the roster.' : ''}</p>}
    </div>
    <div className="observation-roster__pagination">
      <small>20 per page · filters apply to this overview</small>
      <button className="btn" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous students</button>
      <button className="btn" type="button" disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next students</button>
    </div>
  </div>;
}
