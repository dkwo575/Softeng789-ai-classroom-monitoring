import { sharingApi, type SharedSample } from './sharingApi';
import type { ObservationEvent } from './observationModel';

// One request in flight; no offline replay. Closing during startup still closes the returned run.
export function createSharingChannel(student: string, session: string, notice: string,
  callbacks: { onState: (text: string) => void; onFailure: (text: string) => void }, api = sharingApi) {
  const id = crypto.randomUUID();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let lastFrame: number | null = null;
  let interrupted = false;
  let queue: SharedSample[] = [];
  let starting: Promise<boolean> | null = null;
  let stopping: Promise<void> | null = null;
  let pending: Promise<void> | null = null;

  async function pulse() {
    if (closed) return;
    if (lastFrame !== null && performance.now() - lastFrame > 2500) unavailable();
    const batch = queue; queue = [];
    try {
      const camera = interrupted ? 'PAUSED' : lastFrame === null ? 'STARTING' : 'RUNNING';
      await api.pulse(student, id, ++sequence, camera, batch);
      if (closed) return;
      callbacks.onState(camera === 'PAUSED' ? 'Sharing connected · analysis temporarily unavailable' : camera === 'STARTING' ? 'Sharing connected · camera starting' : 'Sharing connected · event metadata only');
      schedule();
    } catch (error) { if (!closed) fail(error instanceof Error ? error.message : 'Sharing connection failed.'); }
  }
  function schedule() { timer = setTimeout(() => { pending = pulse(); }, 5000); }
  function fail(message: string) {
    // Do not await stop from the pulse that it is waiting for.
    void stop().catch(() => {});
    callbacks.onFailure(`${message} No offline events will be replayed. The teacher connection expires within 35 seconds.`);
  }
  function start(): Promise<boolean> {
    if (starting) return starting;
    starting = (async () => {
      try {
        await api.start(student, session, id, notice);
        if (closed) return false;
        callbacks.onState('Sharing connected · camera starting'); schedule(); return true;
      } catch (error) {
        if (!closed) fail(error instanceof Error ? error.message : 'Could not start sharing.');
        return false;
      }
    })();
    return starting;
  }
  function frame(event: ObservationEvent | null) {
    if (closed) return;
    if (lastFrame !== null && performance.now() - lastFrame > 2500) queue = [];
    lastFrame = performance.now();
    interrupted = false;
    if (event) {
      if (queue.length >= 10) { fail('Observation queue limit reached.'); return; }
      queue.push({ kind: event.kind, durationMs: Math.min(60000, Math.round(event.durationMs)) });
    }
  }
  function unavailable() { interrupted = true; queue = []; }
  function stop(): Promise<void> {
    closed = true; clearTimeout(timer); queue = [];
    if (!stopping) stopping = (async () => {
      await starting; await pending;
      // Idempotent stop follows any in-flight start/pulse, including a lost start response.
      await api.stop(student, id);
    })();
    return stopping;
  }
  return { start, frame, stop, unavailable };
}
