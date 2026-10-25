import { useEffect, useState } from 'react';
import { labels } from './observationModel';
import { sharingApi, type SharingDashboard } from './sharingApi';
import './webcamEvents.css';
import { reviewGroups } from './reviewGroups';
import ObservationRoster from './ObservationRoster';

export default function TeacherObservationsPanel({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<SharingDashboard | null>(null);
  const [error, setError] = useState('');
  const [received, setReceived] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState(false);
  const [loadedDetails, setLoadedDetails] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    async function load() {
      if (document.hidden || running || abort.signal.aborted) return;
      running = true; clearTimeout(timer);
      try {
        const result = await sharingApi.dashboard(sessionId, page, AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]), !details);
        if (!abort.signal.aborted) { setData(result); setLoadedDetails(details); setReceived(Date.now()); setClock(Date.now()); setError(''); }
      } catch (error) {
        if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Could not refresh shared observations.');
      } finally {
        running = false;
        if (!abort.signal.aborted && page === 0) timer = setTimeout(() => void load(), 5000);
      }
    }
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', visible); void load();
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [sessionId, page, refresh, details]);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);

  const stale = !!error || clock - received > 15000 || data?.page !== page || loadedDetails !== details;
  const needle = query.trim().toLocaleLowerCase();
  const students = data?.students.filter(s => s.name.toLocaleLowerCase().includes(needle)) ?? [];
  const names = new Map(data?.students.map(s => [s.id, s.name]) ?? []);
  const visibleStudents = new Set(students.map(s => s.id));
  const events = data?.events.filter(e => visibleStudents.has(e.studentId)) ?? [];
  const groups = reviewGroups(events);
  const connected = data?.students.filter(s => ['RUNNING', 'PAUSED'].includes(s.connection?.state ?? '')).length ?? 0;
  async function review(ids: string[], decision: 'REVIEWED' | 'FALSE_POSITIVE') {
    setBusy(ids[0]); setReviewError('');
    try {
      await sharingApi.reviewBatch(sessionId, ids, decision);
      setData(previous => previous && ({ ...previous, events: previous.events.filter(e => !ids.includes(e.id)) }));
      setRefresh(v => v + 1);
    } catch (error) { setReviewError(error instanceof Error ? error.message : 'Review could not be saved.'); }
    finally { setBusy(null); }
  }
  return <section className="webcam-events" aria-label="Shared webcam observations">
    <div className="webcam-events__heading"><h2>Shared webcam observations</h2><span>Phase 3B · voluntary adult pilot</span></div>
    <p>Voluntary event sharing · no live video or attention scores. Connection status does not determine attendance.</p>
    <details className="observation-notice"><summary>About these observations</summary>
      <p>Students explicitly opt in on their own devices. Account names identify the sender, not the person in front of the camera. A missing face or changed head direction does not establish absence, sleep or attention. Review never changes attendance, grades or reports. Records expire after 24 hours or disappear when the student withdraws.</p>
    </details>
    <div className="webcam-events__controls">
      <button className="btn" type="button" onClick={() => setRefresh(v => v + 1)}>Refresh observations</button>
      <span role="status">{!data ? 'Loading…' : !data.enabled ? 'Sharing pilot disabled on this server' : stale ? 'Updates stale · connection status unknown' : `${connected}/${data.students.length} cameras connected`}</span>
    </div>
    {error && <p role="alert" className="webcam-events__error">{error} Last received data is retained below; it is not live.</p>}
    {data?.enabled && <>
      <p><small>Last received: {new Date(received).toLocaleTimeString()}. {page === 0 ? 'Updates every 5 seconds while visible.' : 'Older report page: use Refresh for current status.'}</small></p>
      <ObservationRoster key={sessionId} students={data.students} stale={stale} query={query} onQuery={setQuery} />
      <details className="observation-reports">
      <summary>Review reports and detailed history{query.trim() ? ` · name search: ${query.trim()}` : ''}</summary>
      <div className="webcam-events__heading"><h3>{details ? 'Detailed history' : 'Optional checks'} · page {page + 1}</h3><label><input type="checkbox" checked={details} disabled={!!busy} onChange={e => { setDetails(e.target.checked); setPage(0); }} /> Show detailed history</label></div>
      <p>Normal face visibility and head movements do not need review. Optional checks group no-face (10+ seconds) and multiple-face (2+ seconds) reports by student and type on this page. Separate reports do not prove one uninterrupted condition.</p>
      {reviewError && <p role="alert" className="webcam-events__error">{reviewError}</p>}
      <div className="webcam-events__review-list">
        {!details && groups.map(group => <article key={group.key}>
          <div><strong>{names.get(group.studentId)}</strong><p>{labels[group.kind]}</p><small>{group.reports.length} report(s) on this page · latest received {new Date(group.reports[0].receivedAt).toLocaleTimeString()}</small>
            <details><summary>Show these reports</summary><ul>{group.reports.map(e => <li key={e.id}>{new Date(e.receivedAt).toLocaleTimeString()} · {(e.durationMs / 1000).toFixed(1)}s observed before transmission</li>)}</ul></details>
          </div>
          <div className="webcam-events__controls">
            <button className="btn" type="button" disabled={!!busy || stale} onClick={() => void review(group.reports.map(e => e.id), 'REVIEWED')}>Mark group reviewed</button>
            <button className="btn" type="button" disabled={!!busy || stale} onClick={() => void review(group.reports.map(e => e.id), 'FALSE_POSITIVE')}>Group is false positive</button>
          </div>
        </article>)}
        {details && events.map(e => <article key={e.id}>
          <div><strong>{names.get(e.studentId)}</strong><p>{labels[e.kind]}</p><small>Received {new Date(e.receivedAt).toLocaleTimeString()} · observed for {(e.durationMs / 1000).toFixed(1)}s before transmission</small><p>{e.reviewState === 'INFO' ? 'Information only · no review needed' : e.reviewState === 'FALSE_POSITIVE' ? 'False positive' : e.reviewState === 'REVIEWED' ? 'Reviewed' : 'Available in optional checks'}</p></div>
        </article>)}
        {!(details ? events.length : groups.length) && <p>{details ? 'No matching observations on this page.' : 'No optional checks on this page.'} No data does not mean a student is absent.</p>}
      </div>
      <div className="webcam-events__controls">
        <button className="btn" type="button" disabled={page === 0 || !!busy} onClick={() => setPage(v => v - 1)}>Previous page</button>
        <button className="btn" type="button" disabled={!data.hasMore || !!busy || data.page !== page} onClick={() => setPage(v => v + 1)}>Next page</button>
        {page > 0 && <button className="btn" type="button" onClick={() => setPage(0)}>Return to live page</button>}
      </div>
      </details>
    </>}
  </section>;
}
