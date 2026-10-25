const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: [path.join(__dirname, '../src/features/live-video/peerSession.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function harness(overrides = {}, camera, shared = false) {
  const timers = new Map(), intervals = new Map(), peers = [], errors = [], calls = [];
  let now = 0, timerId = 0;
  const clones = [];
  const track = { readyState: 'live', clone() { const cloned = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} }; clones.push(cloned); return cloned; }, stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const media = { getTracks: () => [track], getVideoTracks: () => [track] };
  class Peer {
    constructor() { this.iceGatheringState = 'complete'; this.connectionState = 'new'; peers.push(this); }
    close() { this.connectionState = 'closed'; }
    addTransceiver(track, init) { assert.equal(init.direction, 'sendonly'); }
    async createOffer() { return { type: 'offer', sdp: 'video-only-offer' }; }
    async setLocalDescription(d) { this.localDescription = d; }
    async setRemoteDescription(d) { this.remoteDescription = d; }
  }
  const api = { start: async () => { calls.push('start'); }, stop: async () => { calls.push('stop'); }, pulse: async () => ({ viewer: 'teacher-window', viewerName: 'Teacher', sdp: null }), ...overrides };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, window: { isSecureContext: true, RTCPeerConnection: Peer }, RTCPeerConnection: Peer,
    navigator: { mediaDevices: { getUserMedia: camera ?? (async options => { assert.equal(options.audio, false); return media; }) } },
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks; } },
    performance: { now: () => now }, crypto: { randomUUID: () => 'run' }, Error,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id)
  });
  const run = module.exports.createVideoSession({ student: 'student', session: 'class', notice: 'v1', ...(shared ? { camera: media } : {}) }, { state() {}, media() {}, failed: e => errors.push(e) }, api);
  return { run, media, track, clones, peers, calls, errors, timers, intervals, clock: value => now = value, fire: async () => { const [id, t] = [...timers][0]; timers.delete(id); t.fn(); await flush(); } };
}
test('stopping during a camera permission prompt releases a late stream without registering sharing', async () => {
  let resolve; const h = harness({}, () => new Promise(r => resolve = r));
  const start = h.run.start(), stop = h.run.stop(); resolve(h.media); await start; await stop;
  assert.equal(h.track.stopped, true); assert(!h.calls.includes('start')); assert.equal(h.timers.size, 0);
});
test('video consent lifecycle closes peer, camera and heartbeat on stop', async () => {
  const h = harness(); await h.run.start(); await flush(); assert.equal(h.peers.length, 1); assert.equal(h.track.stopped, false);
  await h.run.stop(); assert.equal(h.track.stopped, true); assert.equal(h.peers[0].connectionState, 'closed'); assert.equal(h.intervals.size, 0); assert.equal(h.timers.size, 0);
});
test('network loss closes live media instead of continuing an unverified connection', async () => {
  let fail = false; const h = harness({ pulse: async () => { if (fail) throw new Error('offline'); return { viewer: 'viewer', sdp: null }; } });
  await h.run.start(); await flush(); fail = true; await h.fire(); await flush();
  assert.equal(h.track.stopped, true); assert.equal(h.peers[0].connectionState, 'closed'); assert.equal(h.errors.length, 1);
});
test('background scheduling gap stops video before renewing an expired lease', async () => {
  const h = harness(); await h.run.start(); await flush(); h.clock(16000); await h.fire();
  assert.equal(h.track.stopped, true); assert.match(h.errors[0], /paused too long/);
});


test('shared camera is acquired once: video stop releases its clone but preserves analysis track', async () => {
  const h = harness({}, () => { throw new Error('Must reuse the classroom camera'); }, true);
  await h.run.start(); await flush();
  assert.equal(h.errors.length, 0); assert.equal(h.peers.length, 1); assert.equal(h.clones.length, 1);
  await h.run.stop();
  assert.equal(h.clones[0].stopped, true); assert.equal(h.track.stopped, false);
  assert.equal(h.peers[0].connectionState, 'closed');
});

test('video network failure preserves the shared camera for independent observation sharing', async () => {
  let fail = false;
  const h = harness({ pulse: async () => { if (fail) throw new Error('offline'); return { viewer: 'viewer', sdp: null }; } }, undefined, true);
  await h.run.start(); await flush(); fail = true; await h.fire(); await flush();
  assert.equal(h.errors.length, 1); assert.equal(h.clones[0].stopped, true); assert.equal(h.track.stopped, false);
});

test('an ended shared camera cannot create a live-video publication', async () => {
  const h = harness({}, undefined, true); h.track.readyState = 'ended';
  await h.run.start(); await flush();
  assert.equal(h.clones.length, 0); assert(!h.calls.includes('start')); assert.match(h.errors[0], /Start the camera/);
});
