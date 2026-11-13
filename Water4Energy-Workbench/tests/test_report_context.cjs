// A report requested in one context must not appear after the user switches it.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const reportSource=source.slice(source.indexOf('async function exportBrief()'),source.indexOf('// Bind once.'));
const scopeStart=source.indexOf('function liveContext()');
const scopeSource=source.slice(scopeStart,source.indexOf('function clearLiveConversation(',scopeStart));
function fixture(activeContext='tva'){
 let resolve;const response=new Promise(done=>{resolve=done;});
 const button={disabled:false},effects={requests:[],downloads:[],toasts:[]};
 const state={sessionId:'same-session',history:[{role:'user',content:'Read the saved evidence.'}],activeContext,contextRevision:0,config:{project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8001'}};
 const context=vm.createContext({state,$:()=>button,projectUrl:suffix=>'/projects/'+state.config.project+suffix,isAprilContext:()=>state.activeContext==='tva',isLab24Context:()=>state.activeContext==='lab24',api:(...args)=>{effects.requests.push(args);return response;},download:(...args)=>effects.downloads.push(args),toast:text=>effects.toasts.push(text)});
 vm.runInContext(scopeSource+'\n'+reportSource,context);
 return {context,state,effects,button,resolve};
}
const report={title:'Saved evidence',slug_suggestion:'saved-evidence',summary:'Source-backed summary.',body:'Recorded evidence only.'};

test('a report response from an old case, epoch or session cannot download in the current context',async()=>{
 for(const change of ['context','epoch','session']){
  const f=fixture(),pending=f.context.exportBrief();
  assert.equal(f.button.disabled,true);
  assert.equal(f.effects.requests.length,1);
  if(change==='context')f.state.activeContext='headwater';
  if(change==='epoch')f.state.contextRevision++;
  if(change==='session')f.state.sessionId='new-session';
  f.resolve(report);await pending;
  assert.deepEqual(f.effects.downloads,[],change);
  assert.deepEqual(f.effects.toasts,[],change);
  assert.equal(f.button.disabled,false,change);
 }
});

test('a report in the same scope downloads once with the active context hint',async()=>{
 for(const activeContext of ['headwater','lab24','tva']){
  const f=fixture(activeContext),pending=f.context.exportBrief();
  const request=JSON.parse(f.effects.requests[0][1].body);
  assert.equal(request.chat_session_id,'same-session');
  assert.match(request.hint,activeContext==='tva'?/16–22 April 2019/:activeContext==='lab24'?/24 October 2026/:/HEADWATER development/);
  if(activeContext==='lab24'){
   assert.match(request.hint,/public project summary or verified local sources/);
   assert.match(request.hint,/Do not invent approval or execution records/);
   assert.doesNotMatch(request.hint,/Trial 0|dam readout/);
  }
  f.resolve(report);await pending;
  assert.equal(f.effects.downloads.length,1);
  assert.equal(f.effects.downloads[0][0],'saved-evidence.md');
  assert.match(f.effects.downloads[0][1],/Recorded evidence only/);
  assert.equal(f.effects.toasts.length,1);
  assert.equal(f.button.disabled,false);
 }
});
