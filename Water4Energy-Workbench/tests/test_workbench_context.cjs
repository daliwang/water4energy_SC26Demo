// Water4Energy shell/context checks. These never call VISTA or start a job.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('public/index.html');
const app=read('public/app.js');
const plain=value=>String(value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const workflow=()=>require('../public/headwater-workflow.js');

test('the product title and initial screen identify the Water4Energy project and HEADWATER development',()=>{
 assert.match(html,/<title>Water4Energy workbench<\/title>/);
 assert.match(html,/<section\b(?=[^>]*\bid="view-development")(?=[^>]*\bclass="view active")[^>]*>/);
 const firstNav=html.slice(html.indexOf('<nav class="main-nav"')).match(/<button\b[^>]*data-view="([^"]+)"/);
 assert.equal(firstNav?.[1],'development');
 assert.match(html,/<script\b[^>]*src="\/headwater-workflow\.js"/);
 assert.match(html,/<link\b[^>]*href="\/headwater-workflow\.css"/);
});

test('the first screen uses the stored-week comparison and keeps the H100 temperature off Lux',()=>{
 const rendered=workflow().renderHTML(),text=plain(rendered);
 assert.match(text,/the 1979–2017 week already in the example files/);
 assert.doesNotMatch(text,/megawatt/i);
 const lux=rendered.match(/<article\b(?=[^>]*\bid="development-lux-card")[^>]*>([\s\S]*?)<\/article>/)?.[1];
 const h100=rendered.match(/<article\b(?=[^>]*\bid="development-h100-card")[^>]*>([\s\S]*?)<\/article>/)?.[1];
 assert.ok(lux,'The Lux card must be identifiable separately from the H100 result.');
 assert.ok(h100,'The H100 card must be identifiable separately from Lux.');
 assert.doesNotMatch(plain(lux),/0\.77|0\.767|0\.86|0\.861/);
 assert.match(plain(h100),/0\.77/);
 for(const name of ['det_v2_reslim_patch2_obs','det_v2_soil_k9_obs','lux_rocm/valley_cnn','lux_rocm/band','lux_rocm/daily90','lux_rocm/tcwv','lux_rocm/z500','lux_rocm/z850','lux_rocm/layer4'])assert.ok(lux.includes(name),name);
});

test('the TVA study network remains a case view with its 54 locations and April decision context',()=>{
 const start=html.indexOf('<section id="view-network"');
 assert.ok(start>=0);
 const next=html.indexOf('<section id="view-',start+1),network=html.slice(start,next<0?html.length:next);
 assert.match(network,/54 study locations/);
 assert.match(network,/TVA case/);
 assert.match(network,/April|16–22 April 2019/);
 assert.match(network,/fill.or.hold|fill\/hold|flood space/i);
 assert.match(network,/id="network-map"/);
 assert.match(network,/id="network-roster"/);
});

test('the April contract, prompts, stage logic and original brand artwork retain their approved identities',()=>{
 const protectedFiles={
  'public/data/prompts.json':'b15e19fe323b6d5d5bbf8563ac76bfdd9dc973e6be6f189345480e319ac6f205',
  'public/hypothesis-guide.js':'7d5fc18d199a0daeae035dd2c684b46d3027832d58395524fb06e84348a3af51',
  'public/data/demo-case.json':'c5f87d18e2185f9f912f77f96beea6016c2b8a894823fa183a95e2ec5823daa1',
  'public/data/demo-evidence.schema.json':'de79d330e941953d99f620e53c0dfba0be09a0c760c3105200adbae5c78ce572',
  'public/assets/brand/ornl-logo.svg':'60ff1b82680f04daf6095b4e931f2390bd12292189410aa3404c8d1ba33a8efe',
  'public/assets/brand/genesis-mission-black.png':'79c4eaf970b51f307cd7f88f76a70be22cac71d634edde64ae85911f25644f3a',
 };
 for(const [file,expected] of Object.entries(protectedFiles))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),expected,file);
 const definition=JSON.parse(read('public/data/demo-case.json'));
 assert.equal(definition.project,'Water4Energy-TVA-agent-loop');
 assert.equal(definition.version,'0.12.1');
 for(const file of ['Start TVA Workbench.command','Start TVA Workbench.bat','start.sh'])assert.ok(fs.existsSync(path.join(root,file)),file);
});

test('actual live scopes reject a different context and an epoch-only change within the same project/session',()=>{
 const start=app.indexOf('function liveContext()'),end=app.indexOf('function clearLiveConversation(',start);
 assert.ok(start>=0&&end>start,'The app must expose its common live-scope helpers.');
 const state={config:{project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8001'},sessionId:'same-session',activeContext:'headwater',contextRevision:0};
 const context=vm.createContext({state});
 vm.runInContext(app.slice(start,end),context);
 const initial=context.liveContext();assert.equal(context.isLiveContext(initial),true);
 state.activeContext='tva';assert.equal(context.isLiveContext(initial),false);
 state.activeContext='headwater';state.contextRevision++;
 assert.equal(context.isLiveContext(initial),false);
 assert.equal(context.isLiveContext(context.liveContext()),true);
});


test('all project and method requests refuse execution and keep the recorded development stages and separate refinement example explicit',()=>{
 const w=workflow();
 assert.deepEqual(w.STAGES.map(stage=>stage.id),['hypothesis','data','design','execution','score','downscale']);
 assert.deepEqual(w.TRAINING_FLAGS,{h100:false,lux:false});
 assert.equal(w.BOARD.length,5);
 for(const question of w.QUESTIONS){
  const request=w.questionRequest(question.id);
  assert.ok(request.startsWith(question.question+'\n\n'));
  assert.match(request,/Do not submit jobs/);
  assert.match(request,/execute training commands/);
  assert.match(request,/or invent scores/);
  assert.doesNotMatch(request,/Case: 16–22 April 2019/);
 }
 for(const role of ['ledger','proposer','critic','referee','human','evidence']){
  const request=w.methodRequest(role);
  assert.match(request,/Water4Energy project/);
  assert.match(request,/Do not submit jobs/);
  assert.match(request,/or invent scores/);
  assert.doesNotMatch(request,/Case: 16–22 April 2019/);
 }
 assert.equal(w.questionRequest('unknown'),null);
 assert.equal(w.methodRequest('unknown'),null);
});

test('the current shell accepts its version while the unchanged April contract retains its legacy version',()=>{
 const start=app.indexOf('function renderDemoStatus()'),end=app.indexOf('async function refreshDemo',start);
 assert.ok(start>=0&&end>start);
 const line={dataset:{},textContent:''},badge={textContent:''};
 const state={status:{version:'0.15.1',connected:true,project_found:true},demoCase:JSON.parse(read('public/data/demo-case.json')),skills:null,knowledge:null,activeContext:'headwater'};
 const context=vm.createContext({state,WORKBENCH_VERSION:'0.15.1',isAprilContext:()=>false,$:selector=>selector==='#demo-status-line'?line:selector==='#case-figures-status'?badge:null});
 vm.runInContext(app.slice(start,end),context);context.renderDemoStatus();
 assert.equal(line.dataset.state,'connected');
 assert.match(line.textContent,/Water4Energy project/);
 assert.doesNotMatch(line.textContent,/older Workbench|current launcher/);
 assert.equal(state.demoCase.version,'0.12.1');
});

test('the connection hint clears when VISTA has the eight kebab-case skills and a ready source index',()=>{
 const start=app.indexOf('function renderDemoStatus()'),end=app.indexOf('async function refreshDemo',start);
 const line={dataset:{},textContent:''};
 const definition=JSON.parse(read('public/data/demo-case.json'));
 const state={status:{version:'0.15.1',connected:true,project_found:true},demoCase:definition,
  skills:{project_found:true,count:8,skills:definition.requiredSkills.map(skill=>({name:skill.id.replace(/[._]/g,'-')}))},
  knowledge:{project_found:true,all_ready:true}};
 const context=vm.createContext({state,WORKBENCH_VERSION:'0.15.1',isAprilContext:()=>true,$:selector=>selector==='#demo-status-line'?line:null});
 vm.runInContext(app.slice(start,end),context);context.renderDemoStatus();
 assert.equal(line.textContent,'Connected to the April case project.');
 state.skills.skills.pop();context.renderDemoStatus();
 assert.match(line.textContent,/still need setup/);
});
