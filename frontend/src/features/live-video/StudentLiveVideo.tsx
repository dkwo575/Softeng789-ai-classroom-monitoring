import { useEffect, useRef, useState } from 'react';
import { videoApi, type Workspace } from './api';
import { createVideoSession } from './peerSession';
import './liveVideo.css';

export default function StudentLiveVideo({ studentId }: { studentId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [selected, setSelected] = useState('');
  const [consent, setConsent] = useState(false), [active, setActive] = useState(false), [error, setError] = useState('');
  const [state, setState] = useState('Video off'), [viewer, setViewer] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null), current = useRef<ReturnType<typeof createVideoSession> | null>(null);
  useEffect(() => { let cancelled = false; videoApi.workspace(studentId).then(w => { if (!cancelled) setWorkspace(w); }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, [studentId]);
  function stop() { const old = current.current; current.current = null; void old?.stop(); setActive(false); setState('Video off'); setViewer(null); }
  useEffect(() => { const leave = () => stop(); window.addEventListener('pagehide', leave); return () => { window.removeEventListener('pagehide', leave); const old = current.current; current.current = null; void old?.stop(); }; }, []);
  function start() {
    if (!workspace?.enabled || !consent || !selected || current.current) return;
    setError(''); setActive(true);
    const run = createVideoSession({ student: studentId, session: selected, notice: workspace.noticeVersion }, {
      state: setState, viewer: setViewer,
      media: stream => { if (video.current) { video.current.srcObject = stream; if (stream) void video.current.play().catch(() => {}); } },
      failed: message => { current.current = null; setActive(false); setViewer(null); setState('Video off · interrupted'); setError(message); }
    }); current.current = run; void run.start();
  }
  return <section className="live-video" aria-label="Share live video">
    <h2>Share live video · Phase 3C</h2>
    <p>Optional adult pilot. Share your camera with an authorized teacher/admin for this class. Audio is off; this app does not record video or change attendance. Video sharing is separate from the webcam movement test.</p>
    <p>Direct connections can reveal network addresses to the other participant. Keep other people out of view unless they agree. Your account name does not verify who is on camera.</p>
    {error && <p role="alert">{error}</p>}
    {!workspace ? <p>Loading video availability…</p> : !workspace.enabled ? <p>Live video is disabled on this server.</p> : <>
      <label>Video class<select value={selected} disabled={active} onChange={e => setSelected(e.target.value)}><option value="">Choose a class</option>{workspace.sessions.map(s => <option key={s.id} value={s.id} disabled={!s.open}>{s.course} · {new Date(s.startTime).toLocaleString()}{s.open ? '' : ' (closed)'}</option>)}</select></label>
      <label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) stop(); }} /> I am 18 or older and voluntarily agree to share live video with my class teacher/admin. I can stop at any time.</label>
      <div className="live-video__controls"><button className="btn" disabled={active || !consent || !selected} onClick={start}>Start sharing live video</button><button className="btn" disabled={!active} onClick={stop}>Stop sharing live video</button>
        <button className="btn" disabled={active} onClick={() => { setError(''); void videoApi.workspace(studentId).then(setWorkspace).catch(e => setError(e.message)); }}>Refresh video classes</button></div>
    </>}
    <p role="status">{state}{viewer ? ` · Viewer: ${viewer}` : ''}</p>
    <video ref={video} hidden={!active} muted autoPlay playsInline aria-label="Live sharing preview" />
    <small>Local network pilot: maximum four students per class and one teacher viewer per student. Closing this panel, leaving the page or stopping releases the camera.</small>
  </section>;
}
