const test=require('node:test');
const assert=require('node:assert/strict');
const {displayedFigures,createRefresher}=require('../public/live-lab-sync.js');
const project='Water4Energy-TVA-agent-loop';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('conversation previews require a current displayed output and a real listed passive image',()=>{
 const outputs=['figures/rain map.png','extra.webp','orphan.png','active.svg','data.csv'].map(name=>({name}));
 const files=[
  {kind:'outputs',path:'figures/rain map.png',status:'current'},
  {kind:'outputs',path:'figures/rain map.png'},
  {kind:'outputs',name:'extra.webp'},
  {kind:'uploads',path:'orphan.png'},
  {kind:'outputs',path:'missing.png'},
  {kind:'outputs',path:'orphan.png',status:'missing'},
  {kind:'outputs',path:'active.svg'},
  {kind:'outputs',path:'data.csv'},
  {kind:'outputs',path:'../escape.png'},
  {kind:'outputs',path:'https://example.com/a.png'}
 ];
 const result=displayedFigures(files,outputs,project);
 assert.equal(result.length,2);
 assert.equal(result[0].downloadUrl,'/api/vista/projects/Water4Energy-TVA-agent-loop/outputs/figures/rain%20map.png');
 assert.equal(result[0].url,result[0].downloadUrl+'?preview=true');
 assert.deepEqual(displayedFigures(files,null,project),[]);
 assert.deepEqual(displayedFigures(null,outputs,project),[]);
});
test('unsafe or ambiguous names and stale displayed records cannot create previews',()=>{
 const names=['a%2fb.png','a?x.png','a#x.png','x\\y.png','/a.png','a//b.png','a/./b.png','a\n.png','a.png'];
 const files=names.map(path=>({kind:'outputs',path,status:'modified'}));
 assert.deepEqual(displayedFigures(files,names.map(name=>({name})),project),[]);
 assert.deepEqual(displayedFigures([{path:'a.png'}],[{name:'a.png'}],project),[]);
});
test('coalesced current displays are ordered by actual display time and retain redisplay identity',()=>{
 const files=[
  {kind:'outputs',path:'runoff.png',status:'current',run_id:'run-2',tool_call_id:'call-3',shown_at:'2026-11-13T03:00:03Z'},
  {kind:'outputs',path:'temperature.png',status:'current',run_id:'run-1',tool_call_id:'call-1',shown_at:'2026-11-13T03:00:01Z'},
  {kind:'outputs',path:'downscale.png',status:'current',run_id:'run-2',tool_call_id:'call-2',shown_at:'2026-11-13T03:00:02Z'},
  {kind:'outputs',path:'runoff.png',status:'current',run_id:'run-1',tool_call_id:'old-call',shown_at:'2026-11-13T02:00:00Z'},
 ];
 const outputs=['runoff.png','temperature.png','downscale.png'].map(name=>({name}));
 const result=displayedFigures(files,outputs,project);
 assert.deepEqual(result.map(file=>file.name),['temperature.png','downscale.png','runoff.png']);
 assert.equal(result[2].shownAt,'2026-11-13T03:00:03.000Z');
 assert.equal(result[2].displayId,'run-2/call-3/2026-11-13T03:00:03.000Z');
 assert.deepEqual(displayedFigures(files.slice().reverse(),outputs,project),result);
 const redisplayed=displayedFigures([{...files[0],tool_call_id:'new-call',shown_at:'2026-11-13T04:00:00Z'}],outputs,project)[0];
 assert.equal(redisplayed.url,result[2].url);
 assert.notEqual(redisplayed.displayId,result[2].displayId);
});
test('changed records stay excluded even when their display metadata is recent',()=>{
 const record={kind:'outputs',path:'runoff.png',status:'changed',run_id:'run-2',tool_call_id:'call-3',shown_at:'2026-11-13T03:00:03Z'};
 assert.deepEqual(displayedFigures([record],[{name:'runoff.png'}],project),[]);
});
test('a previous conversation read cannot replace the current conversation figures',async()=>{
 const old=deferred(),applied=[];let current='first';
 const sync=createRefresher({read:context=>context==='first'?old.promise:Promise.resolve('new figure'),isCurrent:context=>context===current,apply:(result,context)=>applied.push([context,result])});
 const run=sync.request('first');await Promise.resolve();current='second';sync.invalidate();sync.request('second');old.resolve('old figure');await run;
 assert.deepEqual(applied,[['second','new figure']]);
});
test('many tool events coalesce into one follow-up read without parallel polling',async()=>{
 const first=deferred();let count=0,concurrent=0,maximum=0;const applied=[];
 const sync=createRefresher({read:async()=>{count++;concurrent++;maximum=Math.max(maximum,concurrent);const value=count===1?await first.promise:'latest';concurrent--;return value;},apply:value=>applied.push(value)});
 const run=sync.request('same');await Promise.resolve();for(let i=0;i<20;i++)sync.request('same');first.resolve('initial');await run;
 assert.equal(count,2);assert.equal(maximum,1);assert.deepEqual(applied,['initial','latest']);
});
test('reset invalidates an in-flight read and read failures clear only the current scope',async()=>{
 const wait=deferred(),applied=[],errors=[];let current='first';
 const sync=createRefresher({read:context=>context==='first'?wait.promise:Promise.reject(new Error('unavailable')),isCurrent:context=>context===current,apply:result=>applied.push(result),onError:(error,context)=>errors.push([context,error.message])});
 const run=sync.request('first');await Promise.resolve();sync.invalidate();current='second';sync.request('second');wait.resolve('old');await run;
 assert.deepEqual(applied,[]);assert.deepEqual(errors,[['second','unavailable']]);
});
test('a stale request immediately followed by the current scope is never stranded',async()=>{
 const applied=[],reads=[];
 const sync=createRefresher({isCurrent:context=>context==='current',read:async context=>{reads.push(context);return 'current figure';},apply:(result,context)=>applied.push([context,result])});
 await Promise.all([sync.request('stale'),sync.request('current')]);
 assert.deepEqual(reads,['current']);
 assert.deepEqual(applied,[['current','current figure']]);
});
