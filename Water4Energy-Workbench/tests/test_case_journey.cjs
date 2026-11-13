const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const guide=require('../public/hypothesis-guide.js');
const definition=require('../public/data/demo-case.json');
const prompts=require('../public/data/prompts.json').prompts;
const source=fs.readFileSync(path.join(__dirname,'../public/case-journey.js'),'utf8');
function fixture(){
  const nodes=[],nav=['introduction','network','workspace'].map(view=>control({journeyNav:view}));
  function control(dataset={},attributes={}){return {dataset,attributes,disabled:false,setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},hasAttribute(k){return Object.hasOwn(this.attributes,k);},classList:{toggle(){}},closest(){return this;}};}
  const workflow={set innerHTML(value){this.html=value;nodes.splice(0,nodes.length,...Array.from(value.matchAll(/data-intro-step="([^"]+)"/g),m=>control({introStep:m[1]})));}};
  const detail={innerHTML:''},questions={innerHTML:''},listeners={};
  const document={querySelector:s=>({'#intro-workflow':workflow,'#intro-step-detail':detail,'#case-question-controls':questions}[s]),querySelectorAll:s=>s==='[data-intro-step]'?nodes:s==='[data-journey-nav]'?nav:[],addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const context=vm.createContext({module:{exports:{}},document,fetch:()=>assert.fail('intro and hints must not access a backend')});
  vm.runInContext(source,context);const api=context.module.exports;
  const prepared=[],visited=[];
  api.init({guide,caseDefinition:definition,prompts,preparePrompt:text=>prepared.push(text),navigate:view=>visited.push(view)});
  return {api,prepared,visited,nodes,nav,detail,questions,workflow,control,click:target=>listeners.click({target})};
}
test('the six case questions retain the catalog case and execution guard',()=>{
  const {api}=fixture();
  for(const q of api.questions){const text=api.questionRequest(q.id,{guide,caseDefinition:definition,prompts});assert.ok(text.startsWith(q.question+'\n\n'));assert.match(text,/16–22 April 2019, issued 15 April 2019/);assert.match(text,/Do not submit jobs/);}
  assert.equal(api.questionRequest('dam',{guide,caseDefinition:definition,prompts}),null);
  assert.equal(api.questionRequest('ledger',{guide,caseDefinition:{...definition,project:'Other'},prompts}),null);
  assert.equal(api.questionRequest('ledger',{guide,caseDefinition:{...definition,case:{...definition.case,end:'2019-04-23'}},prompts}),null);
  assert.equal(api.questionRequest('ledger',{guide,caseDefinition:definition,prompts:[{id:'ledger',livePrompt:'Execute a different experiment.'}]}),null);
});
test('each editable April question selects one verified reader profile without changing the original catalog guard',()=>{
  const {api}=fixture();
  const expected={
    ledger:['lab.ledger','ledger'],realization:['lab.realize','weather'],
    downscale:['downscale.scorecard','downscale'],runoff:['lab.realize','runoff'],
    design:['lab.design','design'],commands:['lab.show_command','commands']
  };
  for(const q of api.questions){
    const text=api.questionRequest(q.id,{guide,caseDefinition:definition,prompts});
    const [reader,profile]=expected[q.id];
    const original=prompts.find(prompt=>prompt.id===q.id).livePrompt;
    assert.ok(text.startsWith(q.question+'\n\n'+original+'\n\nSaved-evidence answer\n'));
    assert.ok(text.includes('Use only the '+reader+' saved-evidence reader with the '+profile+' question profile (--question '+profile+').'));
    assert.match(text,/background and safety constraints; its broader focus is not a request for supplementary readers/);
    assert.match(text,/Quote the returned verified_answer exactly/);
    assert.match(text,/Do not paraphrase or add summaries, tables, explanations or claims about other gaps/);
    assert.match(text,/Call display_file for every returned display_paths entry/);
    assert.match(text,/cite source_paths separately/);
    assert.match(text,/If the reader or a required file is unavailable, report what is missing and stop/);
  }
});
test('intro exploration is independent from live following and only an explicit Try prepares work',()=>{
  const f=fixture();
  assert.equal(f.nodes.length,6);
  assert.match(f.workflow.html,/intro-workflow-arrow/);
  f.click(f.nodes.find(n=>n.dataset.introStep==='critic'));
  assert.match(f.detail.innerHTML,/closed or blocked experiment/);
  assert.equal(f.prepared.length,0);
  assert.equal(f.visited.length,0);
  f.click(f.control({}, {'data-intro-prepare':''}));
  assert.equal(f.prepared.length,1);
  assert.match(f.prepared[0],/Focus on the Critic/);
  assert.match(f.prepared[0],/Do not submit jobs/);
  assert.equal(f.api.selectStep('unknown'),false);
});
test('navigation changes only the view, while a case question prepares its explicit fixed request',()=>{
  const f=fixture();
  f.click(f.nav[1]);assert.deepEqual(f.visited,['network']);assert.equal(f.prepared.length,0);
  f.click(f.control({journeyNav:'settings'}));assert.deepEqual(f.visited,['network']);
  f.click(f.control({caseQuestion:'downscale'}));assert.equal(f.prepared.length,1);assert.match(f.prepared[0],/downscale.scorecard/);
  f.api.setView('workspace');assert.equal(f.nav[2].attributes['aria-current'],'page');assert.equal(f.nav[0].attributes['aria-current'],undefined);
  assert.match(f.questions.innerHTML,/data-case-question="runoff"/);
  assert.equal((f.api.welcomeHTML().match(/data-case-question=/g)||[]).length,3);
});
test('the installed completed-cycle module owns method rendering and its questions use the separate lab callback',()=>{
  const calls=[],prepared=[],legacy=[],mount={innerHTML:''},questions={innerHTML:''};
  const lab={init:settings=>calls.push(['init',settings]),selectStep:id=>{calls.push(['select',id]);return id==='critic';},selectedStep:()=> 'critic',questionRequest:id=>'lab24 request '+id,renderMethod:()=>calls.push(['render'])};
  let listener;
  const document={querySelector:s=>s==='#intro-workflow'?mount:s==='#case-question-controls'?questions:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{listener=fn;}};
  const context=vm.createContext({module:{exports:{}},document,Water4EnergyLab24:lab});
  vm.runInContext(source,context);const api=context.module.exports;
  api.init({guide,caseDefinition:definition,prompts,prepareLabPrompt:text=>prepared.push(text),prepareProjectPrompt:text=>legacy.push(text),preparePrompt:text=>legacy.push(text)});
  assert.equal(calls[0][0],'init');assert.equal(typeof calls[0][1].prepareQuestion,'function');
  assert.equal(mount.innerHTML,'','the legacy map must not overwrite the completed-cycle module');
  assert.equal(api.selectStep('critic'),true);
  listener({target:{dataset:{},disabled:false,closest(){return this;},hasAttribute:name=>name==='data-intro-prepare'}});
  assert.deepEqual(prepared,['lab24 request critic']);assert.deepEqual(legacy,[]);
  const april=api.questionRequest('ledger',{guide,caseDefinition:definition,prompts});
  assert.match(april,/16–22 April 2019, issued 15 April 2019/);assert.doesNotMatch(april,/lab24/);
});
