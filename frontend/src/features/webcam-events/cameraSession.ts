export type FrameResult = {
  type: 'result'; timestamp: number; count: number; matrix: number[] | null; inferenceMs: number;
  boxes: { x: number; y: number; width: number; height: number }[];
};
type Callbacks = { onState: (state: string) => void; onFrame: (result: FrameResult) => void; onFailure: (message: string) => void; onUnavailable?: () => void; onMedia?: (stream: MediaStream | null) => void };

export function createCameraSession(video: HTMLVideoElement, callbacks: Callbacks) {
  let closed = false, worker: Worker | null = null, stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let lastVideoTime = -1, lastFrameAt = performance.now();
  let ready = false;
  let paused = false;
  let cameraMuted = false;
  function unavailable() {
    if (!paused) { paused = true; callbacks.onState('Camera retained · analysis temporarily unavailable'); callbacks.onUnavailable?.(); }
  }
  function stop() {
    if (closed) return;
    closed = true;
    clearTimeout(timer); clearTimeout(watchdog);
    worker?.terminate(); worker = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    callbacks.onMedia?.(null);
    video.pause(); video.srcObject = null;
  }
  function fail(message: string) {
    if (closed) return;
    stop(); callbacks.onFailure(message);
  }
  function armTimeout(ms: number, message: string) {
    const deadline = performance.now() + ms;
    clearTimeout(watchdog); watchdog = setTimeout(() => {
      // Background scheduling is not a camera error. Keep the outstanding frame bounded;
      // delayed results are discarded below, and never bridge an observation interval.
      if (ready && (document.hidden || performance.now() - deadline > 1500)) { unavailable(); armTimeout(ms, message); }
      else fail(message);
    }, ms);
  }
  async function frame() {
    if (closed || !ready) return;
    if (cameraMuted || video.readyState < 2 || video.currentTime === lastVideoTime) {
      if (performance.now() - lastFrameAt > 1500) unavailable();
      timer = setTimeout(() => void frame(), 100); return;
    }
    lastVideoTime = video.currentTime;
    lastFrameAt = performance.now();
    armTimeout(5000, 'Analysis timed out. No face event was recorded for this gap. Restart the camera test.');
    try {
      const bitmap = await createImageBitmap(video);
      if (closed) { bitmap.close(); return; }
      try { worker!.postMessage({ type: 'frame', bitmap, timestamp: lastFrameAt }, [bitmap]); }
      catch (error) { bitmap.close(); throw error; }
    } catch { fail('Could not read a camera frame. Restart in a supported browser.'); }
  }
  async function start() {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.Worker || !window.createImageBitmap) {
        throw new Error('This camera test needs HTTPS or localhost and a browser supporting Web Workers and camera access.');
      }
      callbacks.onState('Loading local model…');
      worker = new Worker(new URL('webcam-worker.js', document.baseURI));
      worker.onerror = () => fail('Could not start the local model worker. Check model setup and browser support.');
      worker.onmessage = async ({ data }) => {
        if (closed) return;
        if (data.type === 'error') { fail(data.message); return; }
        if (data.type === 'ready') {
          clearTimeout(watchdog);
          callbacks.onState('Waiting for camera permission…');
          armTimeout(30000, 'Camera permission or playback timed out. Allow camera access and restart.');
          try {
            const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 15 } } });
            if (closed) { acquired.getTracks().forEach(t => t.stop()); return; }
            stream = acquired;
            stream.getVideoTracks().forEach(track => {
              track.addEventListener('ended', () => fail('Camera disconnected or permission was revoked.'));
              track.addEventListener('mute', () => { cameraMuted = true; unavailable(); });
              track.addEventListener('unmute', () => { cameraMuted = false; });
            });
            video.srcObject = acquired;
            await video.play();
            if (closed) return;
            clearTimeout(watchdog); ready = true; lastFrameAt = performance.now();
            callbacks.onMedia?.(acquired);
            callbacks.onState('Camera running · local analysis');
            void frame();
          } catch (error) {
            fail(error instanceof Error ? `Camera unavailable: ${error.message}` : 'Camera access failed. Check permission and restart.');
          }
        } else if (data.type === 'result') {
          clearTimeout(watchdog);
          if (cameraMuted || !Number.isFinite(data.timestamp) || performance.now() - data.timestamp > 1500) unavailable();
          else {
            if (paused) { paused = false; callbacks.onState('Camera running · local analysis'); }
            callbacks.onFrame(data as FrameResult);
          }
          // One outstanding frame only; no frame backlog on slower devices.
          timer = setTimeout(() => void frame(), 200);
        }
      };
      armTimeout(30000, 'Model loading timed out. Check model setup and restart.');
      worker.postMessage({ type: 'init' });
    } catch (error) { fail(error instanceof Error ? error.message : 'Could not start camera test.'); }
  }
  return { start, stop };
}
