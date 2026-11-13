// Exercise the app's asynchronous session boundaries without a browser or VISTA.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const sessionSource=source.slice(source.indexOf('async function loadSession('),source.indexOf('\nasync function newConversation('));
const first='00000000-0000-4000-8000-000000000090';
const second='00000000-0000-4000-8000-000000000091';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

function fixture(){
 const initial=deferred(),artifacts=deferred(),artifactEntered=deferred();
 const effects={watchers:[],busy:[],guideEvents:[],evidenceTopics:[],lab24EvidenceTopics:[],visible:'Current transcript',artifactReads:0};
 const state={sessionId:first,activeContext:'tva',contextRevision:0,config:{project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8790'}};
 const context=vm.createContext({
  state,
  liveContext:()=>({project:state.config.project,backend:state.config.backend_url,session:state.sessionId,activeContext:state.activeContext,contextRevision:state.contextRevision}),
  isLiveContext:scope=>scope.project===state.config.project && scope.backend===state.config.backend_url && scope.session===state.sessionId && scope.activeContext===state.activeContext && scope.contextRevision===state.contextRevision,
  isAprilContext:()=>state.activeContext==='tva',
  api:()=>initial.promise,projectUrl:suffix=>'/projects/'+state.config.project+suffix,
  rememberSession:()=>{},messagesFromHistory:()=>[{role:'agent',text:'First session transcript'}],
  refreshHeadwaterEvidence:prompt=>effects.evidenceTopics.push(prompt),
  refreshLab24Evidence:prompt=>effects.lab24EvidenceTopics.push(prompt),
  $:()=>({replaceChildren:()=>{effects.visible='';}}),
  addMessage:(role,text)=>{effects.visible+=text;},showWelcome:()=>{effects.visible='Welcome';},
  resetActivity:()=>{},addActivity:()=>{},
  TVAHypothesisGuide:{resetConversation:()=>{},handleEvent:(...event)=>effects.guideEvents.push(event),finishTurn:()=>{}},
  loadLiveArtifacts:()=>{effects.artifactReads++;artifactEntered.resolve();return artifacts.promise;},
  setBusy:(...args)=>effects.busy.push(args),
  watchStream:url=>{effects.watchers.push(url);return Promise.resolve();},
 });
 vm.runInContext(sessionSource,context);
 return {context,state,effects,initial,artifacts,artifactEntered};
}
const saved={run_status:'working',run_events:[]};

test('a previous session GET cannot overwrite the newly selected session or transcript',{timeout:2000},async()=>{
 const f=fixture();
 const pending=f.context.loadSession(first,true);
 f.state.sessionId=second;f.effects.visible='Second session transcript';
 f.initial.resolve(saved);await pending;
 assert.equal(f.state.sessionId,second);
 assert.equal(f.effects.visible,'Second session transcript');
 assert.equal(f.effects.artifactReads,0);
 assert.deepEqual(f.effects.watchers,[]);
 assert.deepEqual(f.effects.busy,[]);
});

test('an old artifact read cannot start a watcher after the session or backend changes',{timeout:2000},async()=>{
 for(const change of ['session','backend']){
  const f=fixture();
  const pending=f.context.loadSession(first,true);
  f.initial.resolve(saved);await f.artifactEntered.promise;
  if(change==='session')f.state.sessionId=second;
  else f.state.config.backend_url='http://127.0.0.1:8799';
  f.effects.visible='New scope transcript';
  f.artifacts.resolve();await pending;
  assert.equal(f.effects.visible,'New scope transcript',change);
  assert.equal(f.state.sessionId,change==='session'?second:first,change);
  assert.deepEqual(f.effects.watchers,[],change);
  assert.deepEqual(f.effects.busy,[],change);
 }
});


test('a late session GET cannot overwrite a different case or a returned context with a newer epoch',{timeout:2000},async()=>{
 for(const change of ['case','lab24','epoch']){
  const f=fixture();
  const pending=f.context.loadSession(first,true);
  if(change==='case')f.state.activeContext='headwater';
  if(change==='lab24')f.state.activeContext='lab24';
  // An epoch change also covers TVA → HEADWATER → TVA with the same saved id.
  f.state.contextRevision++;
  f.effects.visible='New context transcript';
  f.initial.resolve(saved);await pending;
  assert.equal(f.effects.visible,'New context transcript',change);
  assert.equal(f.effects.artifactReads,0,change);
  assert.deepEqual(f.effects.watchers,[],change);
  assert.deepEqual(f.effects.busy,[],change);
 }
});

test('a late artifact read cannot reconnect a watcher after the active case or context epoch changes',{timeout:2000},async()=>{
 for(const change of ['case','lab24','epoch']){
  const f=fixture();
  const pending=f.context.loadSession(first,true);
  f.initial.resolve(saved);await f.artifactEntered.promise;
  if(change==='case')f.state.activeContext='headwater';
  if(change==='lab24')f.state.activeContext='lab24';
  f.state.contextRevision++;
  f.effects.visible='New context transcript';
  f.artifacts.resolve();await pending;
  assert.equal(f.effects.visible,'New context transcript',change);
  assert.deepEqual(f.effects.watchers,[],change);
  assert.deepEqual(f.effects.busy,[],change);
 }
});

test('a project-context transcript does not replay its saved events into the April guide',{timeout:2000},async()=>{
 const f=fixture();f.state.activeContext='headwater';
 const pending=f.context.loadSession(first,true);
 f.initial.resolve({...saved,run_status:'done',run_events:[{event:'function_tool_call',data:{part:{tool_name:'lab.realize'}}}]});
 await f.artifactEntered.promise;f.artifacts.resolve();await pending;
 assert.equal(f.effects.visible,'First session transcript');
 assert.deepEqual(f.effects.guideEvents,[]);
 assert.deepEqual(f.effects.watchers,[]);
});

test('HEADWATER history restores evidence for the latest user question only after its scope matches',{timeout:2000},async()=>{
 const f=fixture();f.state.activeContext='headwater';
 f.context.messagesFromHistory=()=>[{role:'user',text:'First question'},{role:'agent',text:'First answer'},{role:'user',text:'Latest question'}];
 const pending=f.context.loadSession(first,true);
 f.initial.resolve({...saved,run_status:'done'});await f.artifactEntered.promise;f.artifacts.resolve();await pending;
 assert.deepEqual(f.effects.evidenceTopics,['Latest question']);
 const stale=fixture();stale.state.activeContext='headwater';
 const old=stale.context.loadSession(first,true);stale.state.contextRevision++;
 stale.initial.resolve({...saved,run_status:'done'});await old;
 assert.deepEqual(stale.effects.evidenceTopics,[]);
});

test('October history restores only its own latest question and cannot replay events into the April guide',{timeout:2000},async()=>{
 const f=fixture();f.state.activeContext='lab24';
 f.context.messagesFromHistory=()=>[{role:'user',text:'Earlier October question'},{role:'agent',text:'Saved answer'},{role:'user',text:'Latest October question'}];
 const pending=f.context.loadSession(first,true);
 f.initial.resolve({...saved,run_status:'done',run_events:[{event:'function_tool_call',data:{part:{tool_name:'lab.design'}}}]});
 await f.artifactEntered.promise;f.artifacts.resolve();await pending;
 assert.deepEqual(f.effects.lab24EvidenceTopics,['Latest October question']);
 assert.deepEqual(f.effects.evidenceTopics,[]);assert.deepEqual(f.effects.guideEvents,[]);
 const stale=fixture();stale.state.activeContext='lab24';
 const old=stale.context.loadSession(first,true);stale.state.activeContext='headwater';stale.state.contextRevision++;
 stale.initial.resolve({...saved,run_status:'done'});await old;
 assert.deepEqual(stale.effects.lab24EvidenceTopics,[]);assert.deepEqual(stale.effects.evidenceTopics,[]);
});


test('an old History selection cannot navigate away after its case or session scope changes',{timeout:2000},async()=>{
 const start=source.indexOf('async function renderHistory()'),end=source.indexOf('\nfunction fileRow(',start);
 const scopeStart=source.indexOf('function liveContext()'),scopeEnd=source.indexOf('function clearLiveConversation(',scopeStart);
 const historySource=source.slice(start,end),scopeSource=source.slice(scopeStart,scopeEnd);
 for(const stale of [true,false]){
  const pendingRead=deferred(),views=[],listeners={};
  const state={busy:false,sessionId:null,activeContext:'headwater',contextRevision:0,status:{project_found:true},config:{project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8790'}};
  const button={dataset:{session:first,sessionContext:'tva'},addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const containers={'#history-list':{innerHTML:''},'#live-history':{innerHTML:''}};
  const context=vm.createContext({state,$:selector=>containers[selector],$$:()=>[button],esc:String,toast:()=>{},projectUrl:path=>path,api:async()=>[{id:first,title:'Saved case',updated_at:'2026-11-12T12:00:00Z'}],sessionContext:()=> 'tva',selectContext:next=>{if(next!==state.activeContext){state.activeContext=next;state.contextRevision++;}return true;},clearLiveConversation:()=>{},resetActivity:()=>{},rememberSession:()=>{},loadSession:()=>pendingRead.promise,switchView:view=>views.push(view)});
  vm.runInContext(scopeSource+'\n'+historySource,context);
  await context.renderHistory();
  const selected=listeners.click();
  if(stale){state.activeContext='headwater';state.contextRevision++;state.sessionId=null;}
  pendingRead.resolve();await selected;
  assert.deepEqual(views,stale?[]:['workspace']);
 }
});
