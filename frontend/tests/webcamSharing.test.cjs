const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({entryPoints:[path.join(__dirname,'../src/features/webcam-events/sharingChannel.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const flush = async () => { for (let i=0;i<25;i++) await Promise.resolve(); };
function harness(overrides={}) {
  const calls=[],states=[],errors=[],timers=new Map();let now=0,id=0;
  const api={start:async(...args)=>{calls.push(['start',...args]);return {};},pulse:async(...args)=>{calls.push(['pulse',...args]);return {};},stop:async(...args)=>{calls.push(['stop',...args]);},...overrides};
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,crypto:{randomUUID:()=> 'run-id'},performance:{now:()=>now},Error,
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const channel=module.exports.createSharingChannel('student','session','notice',{onState:s=>states.push(s),onFailure:e=>errors.push(e)},api);
  return {channel,calls,states,errors,timers,clock:n=>now=n,fire:async()=>{const [id,timer]=[...timers][0]??[];assert(timer);timers.delete(id);timer.fn();await flush();}};
}
test('sharing is explicit; heartbeat carries only bounded event metadata',async()=>{
  const h=harness();assert.equal(h.calls.length,0);await h.channel.start();
  h.channel.frame({kind:'NO_FACE',at:10000,durationMs:10000.4,landmarks:[1,2,3],image:'secret'});
  await h.fire();const call=h.calls.find(c=>c[0]==='pulse');
  assert.equal(call[3],1);assert.equal(call[4],'RUNNING');
  assert.equal(JSON.stringify(call[5]),JSON.stringify([{kind:'NO_FACE',durationMs:10000}]));
  await h.channel.stop();assert.equal(h.timers.size,0);
});
test('stopping during startup closes late server run and never starts heartbeat',async()=>{
  let resolve;const h=harness({start:()=>new Promise(r=>resolve=r)});
  const start=h.channel.start(),stop=h.channel.stop();resolve({});assert.equal(await start,false);await stop;
  assert.equal(h.calls.filter(c=>c[0]==='stop').length,1);assert.equal(h.states.length,0);assert.equal(h.timers.size,0);
});
test('network failure stops sharing without replaying queued observations',async()=>{
  const h=harness({pulse:async()=>{throw new Error('offline');}});await h.channel.start();h.channel.frame(null);await h.fire();await flush();
  assert.match(h.errors[0],/offline/);assert.equal(h.timers.size,0);assert.equal(h.calls.filter(c=>c[0]==='stop').length,1);
  h.channel.frame({kind:'ONE_FACE',at:1,durationMs:1000});assert.equal(h.timers.size,0);
});
test('stalled analysis sends PAUSED with no queued events and recovers without closing camera sharing',async()=>{
  const h=harness();await h.channel.start();h.channel.frame({kind:'NO_FACE',durationMs:10000});h.clock(3000);await h.fire();
  const paused=h.calls.find(c=>c[0]==='pulse');assert.equal(paused[4],'PAUSED');assert.equal(paused[5].length,0);assert.equal(h.errors.length,0);
  h.channel.frame(null);await h.fire();assert.equal(h.calls.filter(c=>c[0]==='pulse').at(-1)[4],'RUNNING');await h.channel.stop();
});
test('visibility interruption discards pending events rather than replaying them on return',async()=>{
  const h=harness();await h.channel.start();h.channel.frame({kind:'NO_FACE',durationMs:10000});h.channel.unavailable();await h.fire();
  assert.equal(h.calls.find(c=>c[0]==='pulse')[5].length,0);await h.channel.stop();
});
test('a scheduling gap followed by a fresh frame discards old queued reports',async()=>{
  const h=harness();await h.channel.start();h.channel.frame({kind:'NO_FACE',durationMs:10000});h.clock(60000);h.channel.frame(null);await h.fire();
  assert.equal(h.calls.find(c=>c[0]==='pulse')[5].length,0);await h.channel.stop();
});

const groupCode=buildSync({entryPoints:[path.join(__dirname,'../src/features/webcam-events/reviewGroups.ts')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
test('review groups isolate students and kinds, omit informational and already reviewed records',()=>{
  const module={exports:{}};vm.runInNewContext(groupCode,{module,exports:module.exports});
  const rows=[['1','a','NO_FACE','PENDING'],['2','a','NO_FACE','PENDING'],['3','a','MULTIPLE_FACES','PENDING'],['4','b','NO_FACE','PENDING'],['5','a','HEAD_TURN','INFO'],['6','a','NO_FACE','REVIEWED'],['7','a','ONE_FACE','PENDING']].map(([id,studentId,kind,reviewState])=>({id,studentId,kind,reviewState}));
  const groups=module.exports.reviewGroups(rows);assert.equal(groups.length,3);assert.equal(groups[0].reports.length,2);
  assert.equal(groups[0].reports[1].id,'2');
});
test('one heartbeat in flight and stop waits before final stop request',async()=>{
  let resolve;const h=harness({pulse:()=>new Promise(r=>resolve=r)});await h.channel.start();await h.fire();
  assert.equal(h.timers.size,0);const stop=h.channel.stop();await flush();assert.equal(h.calls.filter(c=>c[0]==='stop').length,0);
  resolve({});await stop;assert.equal(h.calls.filter(c=>c[0]==='stop').length,1);assert.equal(h.timers.size,0);
});
test('failed start still attempts cleanup and stop is idempotent',async()=>{
  const h=harness({start:async()=>{throw new Error('lost response');}});assert.equal(await h.channel.start(),false);await flush();
  await h.channel.stop();await h.channel.stop();assert.equal(h.calls.filter(c=>c[0]==='stop').length,1);assert.equal(h.errors.length,1);
});
