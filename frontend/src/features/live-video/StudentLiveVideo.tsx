import { useEffect, useRef, useState } from 'react';
import type { Workspace } from './api';
import { createVideoSession } from './peerSession';
import './liveVideo.css';

type Props = { studentId: string; camera: MediaStream | null; selected: string; workspace: Workspace | null };

// Camera ownership belongs to the classroom panel; this control owns only publication.
export default function StudentLiveVideo({ studentId, camera, selected, workspace }: Props) {
  const [sharing, setSharing] = useState(false), [error, setError] = useState('');
  const [state, setState] = useState('Live video sharing off'), [viewer, setViewer] = useState<string | null>(null);
  const current = useRef<ReturnType<typeof createVideoSession> | null>(null);
  const closing = useRef<Promise<void>>(Promise.resolve());

  function stopPublication() {
    const run = current.current; current.current = null;
    if (run) closing.current = run.stop();
  }
  useEffect(() => {
    if (!camera) { setSharing(false); setState('Live video sharing off'); setViewer(null); }
  }, [camera]);
  useEffect(() => {
    if (!camera || !sharing || !workspace?.enabled) return;
    let cancelled = false;
    let run: ReturnType<typeof createVideoSession> | null = null;
    setError(''); setState('Starting live video sharing…');
    void (async () => {
      await closing.current;
      if (cancelled) return;
      run = createVideoSession({ student: studentId, session: selected, notice: workspace.noticeVersion, camera }, {
        state: text => { if (!cancelled) setState(text); },
        viewer: name => { if (!cancelled) setViewer(name); },
        media: () => {},
        failed: message => {
          if (!cancelled) { setSharing(false); setViewer(null); setState('Live video interrupted · camera continues'); setError(message); }
        }
      });
      current.current = run;
      void run.start();
    })();
    return () => {
      cancelled = true;
      if (run) closing.current = run.stop();
      if (current.current === run) current.current = null;
    };
  }, [camera, sharing, workspace, studentId, selected]);
  useEffect(() => {
    const leave = () => { stopPublication(); setSharing(false); setViewer(null); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); stopPublication(); };
  }, []);

  return <fieldset className="live-video" aria-label="Live video sharing">
    <legend>Live video sharing</legend>
    <p>Send video to your authorized class teacher/admin. Audio is off; this app does not record video or change attendance. Direct connections can reveal network addresses to the viewer. Your account name does not verify who is on camera.</p>
    {!workspace ? <p>Loading video availability…</p> : !workspace.enabled ? <p>Live video is disabled on this server.</p> : null}
    <label><input type="checkbox" checked={sharing} disabled={!camera || !workspace?.enabled || !workspace.sessions.some(s => s.id === selected && s.open)} onChange={e => {
      setSharing(e.target.checked);
      if (!e.target.checked) { stopPublication(); setViewer(null); setState('Live video sharing off · camera continues'); }
    }} /> Share live video — I voluntarily agree to share with my class teacher/admin. I can stop at any time.</label>
    <p role="status">{state}{viewer ? ` · Viewer: ${viewer}` : ''}</p>
    {error && <p role="alert">{error}</p>}
    <small>Start the camera before enabling sharing. Turning this off keeps local analysis and observation event sharing running. Local network pilot: maximum four students per class and one teacher viewer per student.</small>
  </fieldset>;
}
