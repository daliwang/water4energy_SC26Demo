// Exercise the real app functions at the context and shared-conversation boundaries.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').split('// Bind once.')[0];
class Element{
  constructor(id=''){this.id=id;this.children=[];this.parentElement=null;this.hidden=false;this.value='';this.dataset={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
  append(child){if(child.parentElement)child.parentElement.children.splice(child.parentElement.children.indexOf(child),1);this.children.push(child);child.parentElement=this;}
  prepend(child){if(child.parentElement)child.parentElement.children.splice(child.parentElement.children.indexOf(child),1);this.children.unshift(child);child.parentElement=this;}
  replaceChildren(){for(const child of this.children)child.parentElement=null;this.children=[];}
  querySelector(selector){return selector==='.lab-chat-title h1'?this.title:null;}
}
function fixture(){
  const elements=Object.fromEntries(['root','conversation-dock','workspace-grid','agent-panel','prompt','active-context','project-live-evidence'].map(id=>[id,new Element(id)]));
  const {root}=elements,panel=elements['agent-panel'],field=elements.prompt;
  panel.title={textContent:'Case Lab'};panel.append(field);
  root.append(elements['conversation-dock']);root.append(elements['workspace-grid']);root.append(elements['project-live-evidence']);elements['workspace-grid'].append(panel);
  const lookup={'.agent-panel':panel,'#view-workspace .hypothesis-lab-grid':elements['workspace-grid'],...Object.fromEntries(Object.entries(elements).map(([id,node])=>['#'+id,node]))};
  const body=new Element('body'),storage=new Map(),effects={loads:[],toasts:[],aborts:0};
  const context=vm.createContext({document:{body,querySelector:selector=>lookup[selector],querySelectorAll:()=>[]},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},clearTimeout:()=>{},TVALiveLabSync:require('../public/live-lab-sync.js'),TVAHypothesisDemo:{reset(){}},TVAHypothesisGuide:{resetConversation(){},setResearchSources(){},setCaseFigures(){}}});
  vm.runInContext('globalThis.window=globalThis;\n'+source+'\nglobalThis.app={state,selectContext,sessionKey,rememberSession,readSessionId,sessionContext,liveContext,isLiveContext,dockConversation};',context);
  context.effects=effects;
  vm.runInContext('resetActivity=()=>{};updateContextUI=()=>{};showWelcome=()=>{};renderResults=()=>{};refreshDemo=async()=>{};loadSession=async(id)=>effects.loads.push(id);toast=text=>effects.toasts.push(text);',context);
  const app=context.app;
  app.state.config={project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8001'};app.state.status={project_found:true};
  return {app,context,effects,elements,field,panel,storage,body};
}
test('switching among all three contexts restores each context’s draft and saved session independently',()=>{
  const f=fixture(),{app,field}=f,contexts=['headwater','lab24','tva'];
  for(const id of contexts){
    assert.equal(app.selectContext(id),true);
    assert.equal(field.value,'','a first visit must not inherit the previous context draft');
    app.state.sessionId='session-'+id;field.value='Unsent '+id+' question';
  }
  for(const id of contexts){
    assert.equal(app.selectContext(id),true);
    assert.equal(app.state.sessionId,'session-'+id,id);
    assert.equal(field.value,'Unsent '+id+' question',id);
    assert.equal(app.sessionContext('session-'+id),id);
  }
  assert.equal(new Set([...f.storage.keys()].filter(key=>key.startsWith('water4energy.session.'))).size,3);
  assert.deepEqual(f.effects.loads,['session-headwater','session-lab24','session-tva']);
  assert.equal(app.selectContext('unrecognized'),false);
});
test('a running turn blocks a different context without losing the draft, session or stream',()=>{
  const f=fixture(),{app,field}=f;
  app.state.sessionId='active-headwater';field.value='Keep this draft';
  app.state.stream={abort:()=>f.effects.aborts++};app.state.busy=true;
  const before=app.liveContext();
  assert.equal(app.selectContext('lab24'),false);
  assert.equal(app.state.sessionId,'active-headwater');assert.equal(field.value,'Keep this draft');
  assert.equal(app.isLiveContext(before),true);assert.equal(f.effects.aborts,0);
  assert.equal(f.effects.toasts.length,1);
  app.state.busy=false;assert.equal(app.selectContext('lab24'),true);
  assert.equal(f.effects.aborts,1);assert.equal(app.isLiveContext(before),false);
});
test('returning to the same saved session after another context cannot revive its earlier asynchronous scope',()=>{
  const f=fixture(),{app}=f;
  app.state.sessionId='headwater-saved';const old=app.liveContext();
  app.selectContext('lab24');app.state.sessionId='october-saved';
  const october=app.liveContext();app.selectContext('tva');app.selectContext('headwater');
  assert.equal(app.state.sessionId,'headwater-saved');
  assert.equal(app.isLiveContext(old),false,'an epoch must distinguish leaving and returning to the same context/session');
  assert.equal(app.isLiveContext(october),false);
  const current=app.liveContext();assert.equal(app.isLiveContext(current),true);
  app.state.config.project='Another-project';assert.equal(app.isLiveContext(current),false);
});
test('HEADWATER, Hypothesis lab and Case Lab move the same conversation node without duplicating controls or losing its draft',()=>{
  const f=fixture(),{app,elements,panel,field}=f;
  field.value='An editable unsent question';field.selectionStart=7;field.selectionEnd=14;
  const initialChildren=[...panel.children];
  const countId=(node,id)=>Number(node.id===id)+node.children.reduce((sum,child)=>sum+countId(child,id),0);
  for(const view of ['development','introduction','workspace','development','workspace']){
    app.state.view=view;app.dockConversation(view);
    assert.equal(panel.parentElement,view==='workspace'?elements['workspace-grid']:elements['conversation-dock']);
    assert.equal(elements['conversation-dock'].hidden,view==='workspace');
    assert.equal(field.value,'An editable unsent question');assert.equal(field.selectionStart,7);assert.equal(field.selectionEnd,14);
    assert.deepEqual(panel.children,initialChildren);
    assert.equal(countId(elements.root,'agent-panel'),1);assert.equal(countId(elements.root,'prompt'),1);
    assert.equal(panel.title.textContent,view==='workspace'?'Case Lab':'Conversation');
  }
});
test('HEADWATER and October refresh project capabilities without reading April case figures',async()=>{
  const containers=Object.fromEntries(['#required-skills','#demo-readiness','#demo-sources'].map(id=>[id,{innerHTML:''}]));
  const context=vm.createContext({module:{exports:{}},document:{querySelector:selector=>containers[selector]||null}});
  const moduleSource=fs.readFileSync(path.join(__dirname,'../public/hypothesis-demo.js'),'utf8');
  vm.runInContext('globalThis.window=globalThis;\n'+moduleSource+'\n'+source+'\nglobalThis.app={state,refreshDemo};renderDemoStatus=()=>{};',context);
  const definition=require('../public/data/demo-case.json');
  const {app}=context;let reads=0;
  context.TVAHypothesisDemo.init({caseDefinition:definition,projectUrl:suffix=>'/api/vista/projects/'+definition.project+suffix,api:()=>{reads++;throw new Error('A non-April context must not fetch case figures');}});
  app.state.demoCase=definition;app.state.status={project_found:true};app.state.config={project:definition.project};
  app.state.skills={project:definition.project,project_found:true,count:8,skills:definition.requiredSkills.map(skill=>({name:skill.id.replace(/[._]/g,'-')}))};
  for(const activeContext of ['headwater','lab24']){
    app.state.activeContext=activeContext;context.TVAHypothesisDemo.reset();await app.refreshDemo();
    assert.equal((containers['#required-skills'].innerHTML.match(/class="demo-badge loaded"/g)||[]).length,8,activeContext);
    assert.equal(reads,0,activeContext);
  }
});
