import { useEffect, useRef, useState } from 'react';
import { createCameraSession, type FrameResult } from './cameraSession';
import { classify, labels, matrixPose, ObservationTimeline, poseDifference, type Observation, type ObservationEvent, type Pose } from './observationModel';
import './webcamEvents.css';

export default function WebcamEventsPanel() {
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

  function clearGeometry() {
    setSample(null); setObservation(null); setDelta(null); setCalibrated(false);
    latest.current = null; reference.current = null; timeline.current = new ObservationTimeline();
  }
  function stop(message = 'Camera off') {
    session.current?.stop(); session.current = null;
    setActive(false); setState(message); clearGeometry();
  }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop('Stopped because this tab was hidden. Start again when ready.'); };
    const leave = () => stop('Camera off');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', leave);
      session.current?.stop(); session.current = null;
    };
  }, []);

  function start() {
    if (!consent || !adult || session.current || !video.current) return;
    clearGeometry(); setEvents([]); setError(''); setActive(true); setStartedAt(performance.now());
    const current = createCameraSession(video.current, {
      onState: setState,
      onFailure: message => { stop('Camera off · test interrupted'); setError(message); },
      onFrame: result => {
        setSample(result);
        const pose = result.count === 1 ? matrixPose(result.matrix) : null;
        latest.current = pose ? { pose, at: performance.now() } : null;
        const change = pose && reference.current ? poseDifference(pose, reference.current) : null;
        setDelta(change);
        const kind = result.count === 1 && pose && !reference.current ? 'ONE_FACE' : classify(result.count, change);
        setObservation(kind);
        const event = timeline.current.update(kind, result.timestamp);
        if (event) setEvents(previous => [event, ...previous].slice(0, 50));
      }
    });
    session.current = current; void current.start();
  }
  function calibrate() {
    if (!latest.current || performance.now() - latest.current.at > 1500) { setError('Wait for a fresh, single-face result before setting the reference.'); return; }
    reference.current = latest.current.pose; timeline.current = new ObservationTimeline();
    setCalibrated(true); setDelta({ yaw: 0, pitch: 0, roll: 0 }); setError('');
  }
  return <section className="webcam-events" aria-label="Webcam movement test">
    <div className="webcam-events__heading"><h2>Webcam movement test</h2><span>Phase 3A · local pilot</span></div>
    <p>Try face visibility and head movement detection on your own camera. This does not verify identity or record attendance, attention or sleep. Your teacher cannot see these results.</p>
    <p>Video is processed on this device. No video, sound or observation events are uploaded or saved. Keep other people out of the frame unless they agree to this local test.</p>
    <label><input type="checkbox" checked={adult} onChange={e => { setAdult(e.target.checked); if (!e.target.checked) { stop(); setEvents([]); } }} /> I am 18 or older and volunteering to test this feature.</label>
    <label><input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); if (!e.target.checked) { stop(); setEvents([]); } }} /> I agree to local camera analysis. I can stop or withdraw at any time.</label>
    <div className="webcam-events__controls">
      <button className="btn btn--primary" type="button" onClick={start} disabled={active || !adult || !consent}>Start camera test</button>
      <button className="btn" type="button" onClick={() => stop()} disabled={!active}>Stop camera test</button>
      <button className="btn" type="button" onClick={calibrate} disabled={!active || sample?.count !== 1 || !latest.current}>Set forward reference</button>
    </div>
    <p role="status">{state}</p>
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
    <p>Only the latest 50 observations are kept in this page's memory. Starting again, leaving this page or withdrawing consent clears them. A missing face does not prove someone left class.</p>
  </section>;
}
