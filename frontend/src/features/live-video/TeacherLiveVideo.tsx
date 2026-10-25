import { useEffect, useRef, useState } from 'react';
import { videoApi, type Board, type StreamView } from './api';
import { createVideoSession } from './peerSession';
import './liveVideo.css';

function VideoTile({ sessionId, stream, watching }: { sessionId: string; stream: StreamView; watching: boolean }) {
  const video = useRef<HTMLVideoElement>(null), [state, setState] = useState('Connecting…'), [error, setError] = useState('');
  const closing = useRef<Promise<void>>(Promise.resolve());
  const [attempt, setAttempt] = useState(0), [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!watching) return;
    let disposed = false; setError('');
    const run = createVideoSession({ session: sessionId, stream: stream.id }, {
      state: text => { if (!disposed) setState(text); },
      media: media => { if (video.current) { video.current.srcObject = media; if (media) void video.current.play().catch(() => {}); } },
      failed: message => { if (!disposed) { setState('Video unavailable'); setError(message); } }
    });
    // Wait for the previous viewer release, including StrictMode effect cleanup and rapid retries.
    void closing.current.then(() => { if (!disposed) void run.start(); });
    const leave = () => { void run.stop(); }; window.addEventListener('pagehide', leave);
    return () => { disposed = true; window.removeEventListener('pagehide', leave); closing.current = run.stop(); };
  }, [sessionId, stream.id, attempt, watching]);
  if (!watching) return null;
  return <article className={`live-video__tile ${expanded ? 'live-video__tile--expanded' : ''}`}>
    <div className="live-video__controls"><strong>{stream.name}</strong><button className="btn" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Reduce' : 'Enlarge'} {stream.name}</button></div>
    <video ref={video} autoPlay muted playsInline aria-label={`Live video of ${stream.name}`} />
    <p role="status">{state}</p>{error && <><p role="alert">{error}</p><button className="btn" onClick={() => setAttempt(v => v + 1)}>Retry {stream.name}</button></>}
  </article>;
}
export default function TeacherLiveVideo({ sessionId }: { sessionId: string }) {
  const [board, setBoard] = useState<Board | null>(null), [watching, setWatching] = useState(false), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function load() {
      try { const result = await videoApi.board(sessionId); if (!disposed) { setBoard(result); setError(''); } }
      catch (e) { if (!disposed) { setError(e instanceof Error ? e.message : 'Video list unavailable'); setWatching(false); setBoard(null); } }
      finally { if (!disposed) timer = setTimeout(() => void load(), 3000); }
    } void load(); return () => { disposed = true; clearTimeout(timer); };
  }, [sessionId, refresh]);
  return <section className="live-video" aria-label="Class live video">
    <h2>Class live video · Phase 3C</h2>
    <p>Only students who explicitly share appear here. Video only · no recording by this app · up to four students. Account names identify senders, not verified faces. Photo attendance stays separate.</p>
    {error && <p role="alert">{error}</p>}
    {board && !board.enabled ? <p>Live video is disabled on this server.</p> : <>
      <div className="live-video__controls"><button className="btn" disabled={!board?.enabled || watching} onClick={() => setWatching(true)}>Start viewing live video</button><button className="btn" disabled={!watching} onClick={() => setWatching(false)}>Stop viewing live video</button><button className="btn" onClick={() => setRefresh(v => v + 1)}>Refresh video list</button></div>
      <p role="status">{board ? `${board.streams.length}/4 students sharing · ${watching ? 'viewing enabled' : 'viewing off'}` : 'Loading video list…'}</p>
      <div className="live-video__grid">{board?.streams.map(s => <VideoTile key={s.id} sessionId={sessionId} stream={s} watching={watching} />)}</div>
      {board?.streams.length === 0 && <p>No students are sharing video. This does not mean they are absent.</p>}
    </>}
    <small>Connection problems do not indicate attention or absence. Optional movement reports remain in the separate observation panel below.</small>
  </section>;
}
