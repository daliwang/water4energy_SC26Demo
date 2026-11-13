const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/lab24.js'),'utf8');
function fixture(){
  const workflow={innerHTML:''},detail={innerHTML:''},listeners={};
  const document={querySelector:s=>({'#intro-workflow':workflow,'#intro-step-detail':detail}[s]),addEventListener:(name,fn)=>{listeners[name]=(listeners[name]||[]).concat(fn);}};
  const context=vm.createContext({document,module:{exports:{}},fetch:()=>assert.fail('Reading a completed cycle must not contact a service')});
  vm.runInContext(source,context);const api=context.module.exports,prepared=[],visited=[],selected=[];
  api.init({prepareQuestion:text=>prepared.push(text),navigate:view=>visited.push(view),onStepChange:id=>selected.push(id)});
  const click=dataset=>listeners.click.forEach(fn=>fn({target:{disabled:false,dataset,closest(){return this;}}}));
  return {api,workflow,detail,listeners,prepared,visited,selected,click};
}
test('the six role questions select only their strict, retrospective reader profile',()=>{
  const f=fixture(),readers={ledger:'lab.ledger',proposer:'lab.design',critic:'lab.design',referee:'lab.design',human:'lab.board',evidence:'lab.ledger'};
  assert.equal(f.api.questions.length,6);
  for(const s of f.api.steps){
    const request=f.api.questionRequest(s.id);
    assert.ok(request.startsWith(s.question+'\n\nWater4Energy project — Hypothesis lab · 24 October 2026.'));
    assert.ok(request.includes('Use only '+readers[s.id]+' with --context lab24 and --question lab24-'+s.id));
    assert.match(request,/Quote the returned verified_answer exactly/);
    assert.match(request,/Call display_file for every returned display_paths entry/);
    assert.match(request,/source_citations separately using their readable titles and links/);
    assert.match(request,/Do not submit jobs/);assert.match(request,/approval receipt/);
    assert.doesNotMatch(request,/--context headwater|--context tva|--question headwater-/);
    assert.equal(f.api.evidenceTopicForRequest(request),s.id);
    assert.equal(f.api.methodRequest(s.id),request);
  }
  assert.equal(f.api.questionRequest('unknown'),null);
  assert.equal(f.api.evidenceTopicForRequest('Unknown question'),'ledger');
  assert.equal(f.api.evidenceTopicForRequest(null),'ledger');
});
test('selecting a role only explains it; preparing a question requires a separate click and never sends',()=>{
  const f=fixture();assert.equal((f.workflow.innerHTML.match(/data-lab24-step=/g)||[]).length,6);
  assert.match(f.workflow.innerHTML,/lab24-loop-arrow/);
  f.click({lab24Step:'critic'});assert.equal(f.api.selectedStep(),'critic');
  assert.match(f.detail.innerHTML,/does not mean the idea worked or a job had started/);
  assert.deepEqual(f.prepared,[]);assert.deepEqual(f.visited,[]);
  f.click({lab24Question:'critic'});assert.equal(f.prepared.length,1);
  assert.match(f.prepared[0],/--question lab24-critic/);
  assert.equal(f.api.selectStep('running'),false);
  f.api.init({prepareQuestion:text=>f.prepared.push(text)});
  assert.equal(f.listeners.click.length,1,'reinitialization must not duplicate request preparation');
  f.click({lab24Question:'evidence'});assert.equal(f.prepared.length,2);
});
test('the cycle uses the public project summary and leaves detailed review decisions to the local reader',()=>{
  const f=fixture(),human=f.api.detailHTML('human'),result=f.api.detailHTML('evidence');
  assert.match(human,/a person picks the experiment and sets its training flag/);
  assert.match(human,/opening a card is not an approval/);
  assert.match(human,/24 October 2026/);assert.match(human,/Weather target weeks: 2019/);
  assert.match(result,/0\.955°C temperature error/);
  assert.match(result,/9×9 soil model[\s\S]*0\.767°C/);
  assert.match(result,/Lower error is better|lower temperature error is better/);
  assert.match(result,/not air temperatures or an all-year average/);
  assert.match(result,/Reslim temperature variants were scored and closed/);
  assert.match(result,/water4energy_SC26Demo\/blob\/d0199a817ddbfa0fbf65c9e81d9fcc53081611ee\/Water4Energy_workbench.md/);
  assert.match(result,/Ask the locally configured reader for the original brief/);
  assert.doesNotMatch(result,/HEADWATER\/blob|January error|needed below|needed at most|approved at/);
  for(const step of f.api.steps){
    const html=f.api.detailHTML(step.id);
    assert.match(html,/Public project summary and recorded results/);
    assert.match(html,/sources available in the local VISTA project/);
  }
});
test('the evidence workspace follows only recognized role topics and never treats model-comparison maps as residual-run outputs',()=>{
  const f=fixture(),container={innerHTML:''};
  for(const s of f.api.steps){f.api.renderContextEvidence(container,{topic:s.id});assert.ok(container.innerHTML.includes('data-lab24-detail="'+s.id+'"'));}
  f.api.renderContextEvidence(container,{topic:'<img src=x onerror=1>'});
  assert.match(container.innerHTML,/data-lab24-detail="ledger"/);assert.doesNotMatch(container.innerHTML,/onerror|<img/);
  assert.match(f.api.questionRequest('evidence'),/comparison maps are prior model comparisons, not the soil-residual test output/);
});
