import { videoApi } from './api';

type Callbacks = { state: (text: string) => void; media: (stream: MediaStream | null) => void; failed: (message: string) => void; viewer?: (name: string | null) => void };
async function description(peer: RTCPeerConnection, type: 'offer' | 'answer') {
  await peer.setLocalDescription(type === 'offer' ? await peer.createOffer() : await peer.createAnswer());
  if (peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); peer.removeEventListener('connectionstatechange', changed); };
    const changed = () => {
      if (peer.connectionState === 'closed') { cleanup(); reject(new Error('Video stopped.')); }
      else if (peer.iceGatheringState === 'complete') { cleanup(); resolve(); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Could not gather a video connection. Try again on a supported local network.')); }, 8000);
    peer.addEventListener('icegatheringstatechange', changed); peer.addEventListener('connectionstatechange', changed); changed();
  });
  return peer.localDescription!.sdp;
}

// No external ICE service is contacted in the local pilot. TURN/SFU deployment is a separate gate.
export function createVideoSession(options: { student: string; session: string; notice: string } | { session: string; stream: string }, cb: Callbacks, api = videoApi) {
  const publishing = 'student' in options;
  const id = publishing ? crypto.randomUUID() : options.stream;
  const viewerId = publishing ? null : crypto.randomUUID();
  let closed = false, peer: RTCPeerConnection | null = null, media: MediaStream | null = null;
  let viewer: string | null = null, sdp: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setInterval> | undefined;
  let lastSuccess = performance.now(), connectingAt = 0;
  let startup: Promise<void> | undefined, pending: Promise<void> | undefined, stopping: Promise<void> | undefined;
  function closePeer() { peer?.close(); peer = null; sdp = null; connectingAt = 0; if (!publishing) { media?.getTracks().forEach(t => t.stop()); media = null; cb.media(null); } }
  function stop(): Promise<void> {
    closed = true; clearTimeout(timer); clearInterval(watchdog); closePeer(); media?.getTracks().forEach(t => t.stop()); media = null; cb.media(null);
    if (!stopping) stopping = (async () => { await startup?.catch(() => {}); await pending?.catch(() => {});
      try { if (publishing) await api.stop(options.student, id); else await api.leave(options.session, id, viewerId!); } catch { /* Server lease expires without renewal. */ }
    })();
    return stopping;
  }
  function fail(error: unknown) { if (!closed) { void stop(); cb.failed(error instanceof Error ? error.message : 'Video connection failed.'); } }
  function makePeer() {
    const next = new RTCPeerConnection({ iceServers: [] }); peer = next; connectingAt = performance.now();
    next.onconnectionstatechange = () => {
      if (closed || peer !== next) return;
      const state = next.connectionState;
      if (state === 'failed') fail(new Error('Video connection failed. Stop and start again; this local pilot may not connect across different networks.'));
      else cb.state(state === 'connected' ? 'Live video connected' : state === 'disconnected' ? 'Video connection interrupted' : 'Connecting video…');
    };
    next.ontrack = event => { if (!closed && !publishing && peer === next) { media = new MediaStream([event.track]); cb.media(media); } };
    return next;
  }
  async function tick() {
    if (closed) return;
    if (performance.now() - lastSuccess > 15000) { fail(new Error('Video sharing paused too long. Start again explicitly.')); return; }
    try {
      const result = publishing ? await api.pulse(options.student, id, viewer, sdp) : await api.watch(options.session, id, viewerId!, sdp);
      if (closed) return; lastSuccess = performance.now();
      if (publishing) {
        cb.viewer?.(result.viewerName);
        if (viewer !== result.viewer) {
          closePeer(); viewer = result.viewer;
          if (viewer) {
            const next = makePeer(); media!.getVideoTracks().forEach(track => next.addTransceiver(track, { direction: 'sendonly', streams: [media!] }));
            const offer = await description(next, 'offer'); if (closed || peer !== next) return; sdp = offer;
          } else cb.state('Camera shared · waiting for teacher');
        }
        if (result.sdp && peer && !peer.remoteDescription) await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      } else if (result.sdp && !peer) {
        const next = makePeer(); await next.setRemoteDescription({ type: 'offer', sdp: result.sdp });
        const answer = await description(next, 'answer'); if (closed || peer !== next) return; sdp = answer;
      }
      if (!closed) timer = setTimeout(() => { pending = tick(); }, 2000);
    } catch (error) { fail(error); }
  }
  function start() {
    if (startup) return startup;
    startup = (async () => {
      try {
        if (!window.isSecureContext || !window.RTCPeerConnection) throw new Error('Live video needs HTTPS or localhost and WebRTC support.');
        if (publishing) {
          cb.state('Waiting for camera permission…');
          const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' } });
          if (closed) { acquired.getTracks().forEach(t => t.stop()); return; }
          media = acquired; media.getTracks().forEach(t => t.addEventListener('ended', () => fail(new Error('Camera stopped or permission was revoked.')))); cb.media(media);
          await api.start(options.student, options.session, id, options.notice);
        }
        if (closed) return;
        lastSuccess = performance.now(); cb.state(publishing ? 'Camera shared · waiting for teacher' : 'Waiting for student video…');
        watchdog = setInterval(() => {
          if (performance.now() - lastSuccess > 15000) fail(new Error('Sharing connection expired. Start again explicitly.'));
          else if (peer && peer.connectionState !== 'connected' && connectingAt && performance.now() - connectingAt > 30000) fail(new Error('Video could not connect. Stop and start again.'));
        }, 1000);
        pending = tick();
      } catch (error) { fail(error); }
    })();
    return startup;
  }
  return { start, stop };
}
