const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
function compile(file) { return buildSync({entryPoints:[path.join(__dirname, '../src/features/webcam-events/', file)],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text; }
function load(code, globals={}) { const module={exports:{}}; vm.runInNewContext(code,{module,exports:module.exports,...globals}); return module.exports; }
const {matrixPose, poseDifference, classify, ObservationTimeline} = load(compile('observationModel.ts'));
test('matrix orientation removes scale and rejects invalid transforms', () => {
  const identity = [2,0,0,0,0,2,0,0,0,0,2,0,0,0,0,1];
  assert.equal(matrixPose(identity).yaw, 0);
  const a=Math.PI/6,c=Math.cos(a),s=Math.sin(a);
  assert(Math.abs(matrixPose([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]).yaw-30)<.0001);
  assert.equal(matrixPose(Array(16).fill(0)),null);assert.equal(matrixPose([NaN]),null);
  assert.equal(poseDifference({yaw:-179,pitch:2,roll:0},{yaw:179,pitch:2,roll:0}).yaw,2);
});
test('multiple faces and no face override head direction; missing pose is not a turn', () => {
  const turned={yaw:30,pitch:0,roll:0};
  assert.equal(classify(0,turned),'NO_FACE');assert.equal(classify(2,turned),'MULTIPLE_FACES');
  assert.equal(classify(1,null),'POSE_UNAVAILABLE');assert.equal(classify(1,turned),'HEAD_TURN');
  assert.equal(classify(1,{yaw:0,pitch:16,roll:0}),'HEAD_TILT');
  assert.equal(classify(1,{yaw:2,pitch:3,roll:2}),'ONE_FACE');
});
test('absence needs ten continuous seconds and emits once until a sustained recovery', () => {
  const t=new ObservationTimeline();
  for(let at=0;at<10000;at+=1000)assert.equal(t.update('NO_FACE',at),null);
  assert.equal(t.update('NO_FACE',10000).kind,'NO_FACE');assert.equal(t.update('NO_FACE',11000),null);
  assert.equal(t.update('ONE_FACE',12000),null);assert.equal(t.update('ONE_FACE',13000).kind,'ONE_FACE');
  for(let at=14000;at<24000;at+=1000)assert.equal(t.update('NO_FACE',at),null);
  assert.equal(t.update('NO_FACE',24000).kind,'NO_FACE');
});
test('gaps and out-of-order timestamps cannot fabricate a sustained event', () => {
  const t=new ObservationTimeline();t.update('NO_FACE',0);t.update('NO_FACE',1000);
  assert.equal(t.update('NO_FACE',12000),null);assert.equal(t.update('NO_FACE',11000),null);
  assert.equal(t.update('NO_FACE',NaN),null);assert.equal(t.update('NO_FACE',13000),null);
  assert.equal(t.update('ONE_FACE',14000),null);assert.equal(t.update('HEAD_TURN',15000),null);
  assert.equal(t.update('HEAD_TURN',16000),null);assert.equal(t.update('HEAD_TURN',17000).kind,'HEAD_TURN');
});
const code=compile('cameraSession.ts');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function harness() {
  const workers=[],requests=[],states=[],frames=[],errors=[],timers=new Map();let id=0,now=0;
  const document={baseURI:'http://localhost:5173/',hidden:false};
  class Worker { constructor(){this.messages=[];this.terminated=false;workers.push(this);} postMessage(m){this.messages.push(m);} terminate(){this.terminated=true;} }
  const video={srcObject:null,currentTime:0,readyState:2,play:async()=>{},pause(){}};
  let bitmap={closed:false,close(){this.closed=true;}};
  const globals={URL,document,window:{isSecureContext:true,Worker,createImageBitmap:()=>{}},Worker,
    navigator:{mediaDevices:{getUserMedia:()=>new Promise(resolve=>requests.push(resolve))}},performance:{now:()=>now},
    createImageBitmap:()=>Promise.resolve(bitmap),setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),Error};
  const api=load(code,globals);const session=api.createCameraSession(video,{onState:s=>states.push(s),onFrame:f=>frames.push(f),onFailure:e=>errors.push(e)});
  const track={stopped:false,handlers:{},stop(){this.stopped=true;},addEventListener(k,fn){this.handlers[k]=fn;}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  return {session,video,track,stream,workers,requests,states,frames,errors,timers,document,get bitmap(){return bitmap;},setBitmap:b=>bitmap=b,
    clock:n=>now=n,fire:ms=>{const item=[...timers].find(([,v])=>v.ms===ms);assert(item,`timer ${ms}`);timers.delete(item[0]);item[1].fn();},
    ready:async()=>{await session.start();void workers[0].onmessage({data:{type:'ready'}});await flush();requests[0](stream);await flush();}};
}
test('stopping before model ready never requests the camera', async()=>{
  const h=harness();await h.session.start();h.session.stop();await h.workers[0].onmessage({data:{type:'ready'}});
  assert.equal(h.requests.length,0);assert(h.workers[0].terminated);assert.equal(h.timers.size,0);
});
test('late permission after stop releases all acquired tracks without playback', async()=>{
  const h=harness();await h.session.start();const pending=h.workers[0].onmessage({data:{type:'ready'}});
  h.session.stop();h.requests[0](h.stream);await pending;assert(h.track.stopped);assert.equal(h.video.srcObject,null);
});
test('only one frame is in flight; stop clears timers, media and worker', async()=>{
  const h=harness();await h.ready();assert.equal(h.workers[0].messages.filter(m=>m.type==='frame').length,1);
  assert(![...h.timers.values()].some(t=>t.ms===200));
  await h.workers[0].onmessage({data:{type:'result',timestamp:0,count:0,boxes:[],matrix:null,inferenceMs:10}});
  h.video.currentTime=1;h.clock(200);h.fire(200);await flush();assert.equal(h.frames.length,1);
  assert.equal(h.workers[0].messages.filter(m=>m.type==='frame').length,2);
  h.session.stop();assert(h.track.stopped);assert(h.workers[0].terminated);assert.equal(h.timers.size,0);
});
test('camera disconnect and inference timeout stop without producing face observations', async()=>{
  const h=harness();await h.ready();h.track.handlers.ended();assert(h.track.stopped);assert.equal(h.frames.length,0);assert.match(h.errors[0],/disconnected/);
  const stalled=harness();await stalled.ready();stalled.fire(5000);assert.equal(stalled.frames.length,0);assert(stalled.track.stopped);assert.match(stalled.errors[0],/timed out/);
});
test('model failure and playback failure clean up and expose a retryable message', async()=>{
  const h=harness();await h.session.start();await h.workers[0].onmessage({data:{type:'error',message:'Model missing'}});
  assert.equal(h.errors[0],'Model missing');assert(h.workers[0].terminated);assert.equal(h.requests.length,0);
  const p=harness();p.video.play=async()=>{throw new Error('blocked')};await p.ready();assert(p.track.stopped);assert.match(p.errors[0],/blocked/);assert.equal(p.frames.length,0);
});
test('hidden tab retains media and ignores delayed inference, then accepts fresh frames',async()=>{
  const h=harness();await h.ready();h.document.hidden=true;h.clock(6000);h.fire(5000);
  assert.equal(h.track.stopped,false);assert.equal(h.errors.length,0);
  await h.workers[0].onmessage({data:{type:'result',timestamp:0,count:0,boxes:[]}});assert.equal(h.frames.length,0);
  h.document.hidden=false;h.video.currentTime=6;h.fire(200);await flush();
  await h.workers[0].onmessage({data:{type:'result',timestamp:6000,count:1,boxes:[]}});assert.equal(h.frames.length,1);
  h.session.stop();assert(h.track.stopped);
});
test('frozen preview and muted tracks pause analysis without reporting a missing face',async()=>{
  const h=harness();await h.ready();h.track.handlers.mute();
  await h.workers[0].onmessage({data:{type:'result',timestamp:0,count:0,boxes:[]}});assert.equal(h.frames.length,0);
  h.clock(3000);h.fire(200);await flush();assert.equal(h.track.stopped,false);assert.equal(h.errors.length,0);
  h.track.handlers.unmute();h.video.currentTime=3;h.fire(100);await flush();
  await h.workers[0].onmessage({data:{type:'result',timestamp:3000,count:1,boxes:[]}});assert.equal(h.frames.length,1);h.session.stop();
});
test('a delayed timer on foreground return is not treated as a model failure',async()=>{
  const h=harness();await h.ready();h.clock(60000);h.fire(5000);assert.equal(h.errors.length,0);assert.equal(h.track.stopped,false);h.session.stop();
});
