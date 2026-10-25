import { useEffect, useRef, useState } from 'react';
import { createCameraSession, type FrameResult } from './cameraSession';
import { classify, labels, matrixPose, ObservationTimeline, poseDifference, type Observation, type ObservationEvent, type Pose } from './observationModel';
import './webcamEvents.css';
import { sharingApi, type SharingWorkspace } from './sharingApi';
import { createSharingChannel } from './sharingChannel';

export default function WebcamEventsPanel({ studentId }: { studentId?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ReturnType<typeof createCameraSession> | null>(null);
  const timeline = useRef(new ObservationTimeline());
  const reference = useRef<Pose | null>(null);
  const latest = useRef<{ pose: Pose; at: number } | null>(null);
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [active, setActive] = useState(false);
  const [state, setState] = useState('Camera off');
  const [error, setError] = useState('');
  const [sample, setSample] = useState<FrameResult | null>(null);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [delta, setDelta] = useState<Pose | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const [events, setEvents] = useState<ObservationEvent[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [workspace, setWorkspace] = useState<SharingWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [share, setShare] = useState(false);
  const [sharingState, setSharingState] = useState('Local test only · not sharing');
  const [withdrawing, setWithdrawing] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [sharingLost, setSharingLost] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const channel = useRef<ReturnType<typeof createSharingChannel> | null>(null);
  const closing = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    if (!studentId) return;
    const abort = new AbortController();
    sharingApi.workspace(studentId, abort.signal).then(setWorkspace).catch(error => {
      if (!abort.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load sharing sessions. Local testing is still available.');
    });
    return () => abort.abort();
  }, [studentId, refresh]);

  function clearGeometry() {
    setSample(null); setObservation(null); setDelta(null); setCalibrated(false);
    latest.current = null; reference.current = null; timeline.current = new ObservationTimeline();
  }
  function stop(message = 'Camera off') {
    generation.current++;
    session.current?.stop(); session.current = null;
    const current = channel.current; channel.current = null;
    if (current) {
      setSharingState('Sharing stopped');
      closing.current = current.stop().catch(() => {
        if (mounted.current) setSharingState('Stopped locally · server confirmation unavailable; connection expires within 35 seconds.');
      });
    }
    setActive(false); setState(message); clearGeometry();
  }
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      // A coding window or minimized tab is not absence. Retain capture, reset continuity.
      timeline.current = new ObservationTimeline(); latest.current = null;
      setSample(null); setObservation(null); setDelta(null);
      channel.current?.unavailable();
    };
    const leave = () => stop('Camera off');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false; generation.current++;
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave);
      session.current?.stop(); session.current = null;
      void channel.current?.stop().catch(() => {}); channel.current = null;
    };
  }, []);

  async function connectSharing() {
    if (!studentId || !workspace || !share || !adult || !consent || channel.current) return false;
    setSharingLost(false); setSharingState('Connecting sharing…');
    const sharing = createSharingChannel(studentId, selected, workspace.noticeVersion, {
      onState: setSharingState,
      onFailure: message => {
        channel.current = null; closing.current = sharing.stop().catch(() => {});
        setSharingLost(true); setSharingState('Sharing disconnected · local camera may continue'); setError(message);
      }
    });
    channel.current = sharing;
    return sharing.start();
  }
  async function reconnectSharing() {
    setReconnecting(true); setError('');
    timeline.current = new ObservationTimeline();
    try { await closing.current; if (session.current) await connectSharing(); }
    finally { if (mounted.current) setReconnecting(false); }
  }

  async function start() {
    if (!consent || !adult || session.current || !video.current) return;
    if (share && (!studentId || !workspace?.enabled || !workspace.sessions.some(s => s.id === selected && s.open))) {
      setError('Select an open class before sharing. Refresh sessions if the schedule changed.'); return;
    }
    const attempt = ++generation.current;
    clearGeometry(); setEvents([]); setError(''); setActive(true); setStartedAt(performance.now());
    if (share && studentId && workspace) {
      const connected = await connectSharing();
      if (generation.current !== attempt || !video.current) return;
      if (!connected) { setActive(false); return; }
    } else setSharingState('Local test only · not sharing');
    const current = createCameraSession(video.current, {
      onState: setState,
      onFailure: message => { stop('Camera off · test interrupted'); setError(message); },
      onUnavailable: () => {
        timeline.current = new ObservationTimeline(); latest.current = null;
        setSample(null); setObservation(null); setDelta(null); channel.current?.unavailable();
      },
      onFrame: result => {
        setSample(result);
        const pose = result.count === 1 ? matrixPose(result.matrix) : null;
        latest.current = pose ? { pose, at: performance.now() } : null;
        const change = pose && reference.current ? poseDifference(pose, reference.current) : null;
        setDelta(change);
        const kind = result.count === 1 && pose && !reference.current ? 'ONE_FACE' : classify(result.count, change);
        setObservation(kind);
        const event = timeline.current.update(kind, result.timestamp);
        channel.current?.frame(event);
        if (event) setEvents(previous => [event, ...previous].slice(0, 50));
      }
    });
    session.current = current; void current.start();
  }
  async function withdraw() {
    if (!studentId) return;
    setWithdrawing(true); stop(); setShare(false); setEvents([]); setError('');
    try {
      await closing.current;
      await sharingApi.withdraw(studentId);
      if (mounted.current) setSharingState('Sharing withdrawn · all your retained shared observations deleted');
    } catch (error) {
      if (mounted.current) setError(`Camera is off, but deletion was not confirmed. Retry Withdraw and delete. ${error instanceof Error ? error.message : ''}`);
    } finally { if (mounted.current) setWithdrawing(false); }
  }
  function calibrate() {
    if (!latest.current || performance.now() - latest.current.at > 1500) { setError('Wait for a fresh, single-face result before setting the reference.'); return; }
    reference.current = latest.current.pose; timeline.current = new ObservationTimeline();
    setCalibrated(true); setDelta({ yaw: 0, pitch: 0, roll: 0 }); setError('');
  }
  return <section className="webcam-events" aria-label="Webcam movement test">
    <div className="webcam-events__heading"><h2>Webcam movement test</h2><span>Phase 3B · voluntary adult pilot</span></div>
    <p>Try face visibility and head movement detection on your own camera. This does not verify identity or record attendance, attention or sleep. Testing stays private unless you explicitly enable sharing below.</p>
    <p>Video is processed on this device. Video, sound, face images and landmarks are never uploaded by this feature. Keep other people out of the frame unless they agree to this test.</p>
    <label><input type="checkbox" checked={adult} onChange={e => { setAdult(e.target.checked); if (!e.target.checked) { stop(); setEvents([]); } }} /> I am 18 or older and volunteering to test this feature.</label>
    <label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) { stop(); setEvents([]); } }} /> I agree to local camera analysis. I can stop or withdraw at any time.</label>
    {studentId && <fieldset className="webcam-events__sharing">
      <legend>Optional sharing with your class teacher</legend>
      <p>Only event type, observed duration, server receipt time and connection state are shared under your account. Your class teachers and admins can review these unverified observations. They cannot use this feature to save attendance, grades or attention scores.</p>
      <p>Records expire 24 hours after each sharing run starts. Stopping retains them until expiry; Withdraw and delete removes all your retained shared observations. Participation is optional and manual/photo attendance remains available.</p>
      {!workspace ? <p>Loading sharing availability…</p> : !workspace.enabled ? <p>Event sharing is disabled on this server. The local camera test is available.</p> : <>
        <label htmlFor="webcam-session">Class session</label>
        <select id="webcam-session" value={selected} disabled={active || withdrawing} onChange={e => setSelected(e.target.value)}>
          <option value="">Choose a class</option>
          {workspace.sessions.map(s => <option key={s.id} value={s.id} disabled={!s.open}>{s.course} · {new Date(s.startTime).toLocaleString()} {s.open ? '' : '(closed)'}</option>)}
        </select>
        {!workspace.sessions.some(s => s.open) && <p>No open classes. Sharing opens 15 minutes before class and closes at its end.</p>}
        <label><input type="checkbox" checked={share} disabled={active || withdrawing} onChange={e => setShare(e.target.checked)} /> I voluntarily agree to share these observations with my class teacher and admins for this pilot.</label>
      </>}
      <div className="webcam-events__controls">
        <button className="btn" type="button" disabled={active || withdrawing} onClick={() => setRefresh(v => v + 1)}>Refresh sharing sessions</button>
        <button className="btn" type="button" disabled={withdrawing} onClick={() => void withdraw()}>{withdrawing ? 'Deleting…' : 'Withdraw and delete shared observations'}</button>
      </div>
      <p role="status">{sharingState}</p>
      {active && sharingLost && <button className="btn" type="button" disabled={reconnecting || withdrawing} onClick={() => void reconnectSharing()}>{reconnecting ? 'Reconnecting…' : 'Reconnect event sharing'}</button>}
    </fieldset>}
    <div className="webcam-events__controls">
      <button className="btn btn--primary" type="button" onClick={() => void start()} disabled={active || withdrawing || !adult || !consent || (share && !selected)}>{share ? 'Start camera and share events' : 'Start camera test'}</button>
      <button className="btn" type="button" onClick={() => stop()} disabled={!active}>Stop camera test</button>
      <button className="btn" type="button" onClick={calibrate} disabled={!active || sample?.count !== 1 || !latest.current}>Set forward reference</button>
    </div>
    <p role="status">{state}</p>
    <p>Camera capture stays enabled when switching windows or minimizing. Your browser may pause analysis in the background; missing samples are never counted as absence. Stop the test, close this panel or leave the page to release the camera.</p>
    {error && <p className="webcam-events__error" role="alert">{error}</p>}
    <div className="webcam-events__preview" hidden={!active}>
      <video ref={video} muted playsInline aria-label="Local webcam preview" />
      {sample?.boxes.map((box, index) => <span key={index} className="webcam-events__box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}><b>Face {index + 1}</b></span>)}
    </div>
    {sample && <div className="webcam-events__readout">
      <strong>{observation ? labels[observation] : 'Waiting for a result'}</strong>
      <span>Inference: {Math.round(sample.inferenceMs)} ms · up to 5 samples/second</span>
      {delta && <span>Change from reference: yaw {delta.yaw.toFixed(0)}° · pitch {delta.pitch.toFixed(0)}° · roll {delta.roll.toFixed(0)}°</span>}
    </div>}
    <p>{calibrated ? 'Reference set. Slowly turn or tilt your head to test direction changes.' : 'Look straight at the camera, then choose Set forward reference to test head direction.'} Preview is not mirrored. Reference resets when the test stops.</p>
    <p>Local event thresholds: no face for 10 seconds; multiple faces or changed head direction for 2 seconds. Poor lighting and occlusion can cause missed detections. Camera errors and stalled frames are not absence events.</p>
    <div className="webcam-events__heading"><h3>Local observations ({events.length}/50)</h3><button className="btn" type="button" disabled={!events.length} onClick={() => setEvents([])}>Clear observations</button></div>
    {!events.length ? <p>No sustained observations yet.</p> : <ol className="webcam-events__history">{events.map((event, index) => <li key={`${event.at}-${index}`}><strong>{labels[event.kind]}</strong><span>{Math.round((event.at - startedAt) / 1000)}s after start · observed for {(event.durationMs / 1000).toFixed(1)}s</span></li>)}</ol>}
    <p>Only the latest 50 local observations are kept in this page's memory. Clearing this list does not delete shared records; use Withdraw and delete for that. Starting again or leaving clears the local list. A missing face does not prove someone left class.</p>
  </section>;
}
