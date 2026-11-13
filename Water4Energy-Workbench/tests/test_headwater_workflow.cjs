const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/headwater-workflow.js'),'utf8');
function fixture(){
  const controls=[],detail={innerHTML:''},video={outerHTML:''},connections=[],listeners={};
  const mount={html:'',set innerHTML(value){this.html=value;controls.splice(0,controls.length,...Array.from(value.matchAll(/data-development-stage="([^"]+)"/g),m=>control({developmentStage:m[1]})));},querySelectorAll:s=>s==='[data-development-stage]'?controls:s==='[data-development-connection]'?connections:[],querySelector:s=>s==='#development-stage-detail'?detail:s==='[data-headwater-video]'?video:null};
  function control(dataset={}){return {dataset,disabled:false,setAttribute(){},closest(){return this;}};}
  const document={querySelector:s=>s==='#headwater-workflow'?mount:null,addEventListener:(name,callback)=>{listeners[name]=callback;}};
  const context=vm.createContext({document,module:{exports:{}},fetch:()=>assert.fail('HEADWATER stage selection must not contact a service')});
  vm.runInContext(source,context);
  const api=context.module.exports,prepared=[],visited=[];
  api.init({prepareQuestion:text=>prepared.push(text),navigate:view=>visited.push(view)});
  return {api,prepared,visited,mount,detail,video,control,click:target=>listeners.click({target})};
}
test('stage selection only opens the supplied card; explicit review and navigation retain separate callbacks',()=>{
  const f=fixture();
  for(const stage of f.api.STAGES){f.click(f.control({developmentStage:stage.id}));assert.match(f.detail.innerHTML,new RegExp('<h2>'+stage.title+'</h2>'));}
  assert.deepEqual(f.prepared,[]);assert.deepEqual(f.visited,[]);
  f.click(f.control({headwaterQuestion:'brief'}));
  assert.equal(f.prepared.length,1);assert.ok(f.prepared[0].startsWith('What is the one change in the current brief?'));
  assert.match(f.prepared[0],/Do not submit jobs/);assert.match(f.prepared[0],/or invent scores/);assert.deepEqual(f.visited,[]);
  f.click(f.control({headwaterNav:'introduction'}));assert.deepEqual(f.visited,['introduction']);
  f.click(f.control({headwaterNav:'settings'}));assert.deepEqual(f.visited,['introduction']);
});
test('missing or unapproved media remain hidden or empty; approved video requires captions and never autoplays',()=>{
  const f=fixture();f.api.selectStage('score');
  let html=f.api.renderHTML();assert.match(html,/data-headwater-video hidden/);assert.doesNotMatch(html,/<video/);assert.match(html,/April map supplied for the demo/);assert.match(html,/tva_t2m_2019_reslim.png/);assert.doesNotMatch(html,/water4energy-april-2019-score.png/);
  f.api.setAssets({video:'/assets/water4energy-workbench-90s.mp4'});assert.doesNotMatch(f.api.renderHTML(),/<video/);
  f.api.setAssets({video:'https://example.org/video.mp4',captions:'/assets/water4energy-workbench-90s.vtt',scoreMap:'/api/vista/projects/Other/outputs/map.png'});html=f.api.renderHTML();assert.doesNotMatch(html,/<video|projects\/Other/);assert.match(html,/tva_t2m_2019_reslim.png/);
  f.api.setAssets({video:'/assets/water4energy-workbench-90s.mp4',captions:'/assets/water4energy-workbench-90s.vtt',scoreMap:'/assets/water4energy-april-2019-score.png'});html=f.api.renderHTML();assert.match(html,/<video controls playsinline preload="none"/);assert.match(html,/<track kind="captions"[^>]+ default>/);assert.doesNotMatch(html,/autoplay/);assert.match(html,/<figcaption>16–22 April 2019/);assert.match(html,/water4energy-april-2019-score.png/);
});
test('connection messages cannot insert score claims into the Lux card and the evidence stays a supplied project record',()=>{
  const f=fixture();
  f.api.setResources([{id:'lux',state:'ready',message:'Lux 0.77 made-up score'},{id:'ccsi',state:'ready',planned:true}]);
  const html=f.api.renderHTML(),lux=html.match(/<article[^>]+id="development-lux-card"[\s\S]*?<\/article>/)[0];
  assert.match(lux,/Connection: Ready in VISTA/);assert.doesNotMatch(lux,/0\.77|made-up/);assert.match(html,/H100 \/ CCSI[\s\S]*?Connection: Planned connection/);
  const evidence={innerHTML:''};assert.equal(f.api.renderContextEvidence(evidence),true);assert.match(evidence.innerHTML,/Project record · 12 November 2026/);assert.match(evidence.innerHTML,/the 1979–2017 week already in the example files/);assert.match(evidence.innerHTML,/0\.77°C/);
});

test('the first view explains one recorded example and its result before technical supporting records',()=>{
  const f=fixture(),html=f.api.renderHTML(),lead=html.split('<details class="development-disclosure')[0];
  assert.match(lead,/one recorded example/);
  assert.match(lead,/soil conditions and nearby locations/);
  assert.match(lead,/Development records: October–November 2026 · Weather test weeks: 2019/);
  assert.match(lead,/Across four saved 2019 test weeks/);
  assert.match(lead,/Lower error is better/);
  assert.match(lead,/error, not the actual temperature/);
  assert.match(lead,/Recorded result · H100 \/ CCSI/);
  assert.match(lead,/0\.77°C[\s\S]*0\.86°C/);
  assert.doesNotMatch(lead,/det_v2_|lux_rocm|human_flag|root-mean-square/);
  assert.match(html,/<details class="development-disclosure development-history"><summary>/);
  assert.match(html,/<details class="development-disclosure"><summary><span>Machines and supporting records/);
  assert.match(html,/<details class="development-disclosure"><summary><span>Planned work and human review/);
  assert.doesNotMatch(html,/<details class="development-disclosure[^>]*\bopen\b/);
});

test('the history uses public project records without private backend files or manufactured execution times',()=>{
  const f=fixture();
  assert.deepEqual(Array.from(f.api.HISTORY,row=>row.date),['2026-10-18','2026-10-24','2026-10-26','2026-11-12']);
  for(const row of f.api.HISTORY)assert.match(row.source,/^https:\/\/github.com\/daliwang\/water4energy_SC26Demo\/blob\/d0199a817ddbfa0fbf65c9e81d9fcc53081611ee\/Water4Energy_workbench.md#/);
  const html=f.api.renderHTML();
  assert.match(html,/<th scope="col">Record date<\/th>/);
  assert.match(html,/document dates, not reported training start or completion times/);
  assert.match(html,/The weather test weeks are in 2019/);
  assert.match(html,/written next trunk still needs a script and board row/);
  f.api.selectStage('design');assert.match(f.detail.innerHTML,/does not isolate the effect of adding soil information alone/);
  assert.match(f.detail.innerHTML,/a brief that names one change/);
  assert.match(f.detail.innerHTML,/A person picks the experiment/);
});

test('each primary question explicitly selects the HEADWATER reader profile and readable evidence citations',()=>{
  const f=fixture(),expected={ledger:['lab.ledger','headwater-ledger'],brief:['lab.design','headwater-brief'],data:['lab.download','headwater-data'],board:['lab.board','headwater-board'],score:['lab.ledger','headwater-score']};
  assert.equal(f.api.QUESTIONS.length,5);
  for(const q of f.api.QUESTIONS){
    const request=f.api.questionRequest(q.id),[reader,profile]=expected[q.id];
    assert.ok(request.startsWith(q.question+'\n\n'));
    assert.ok(request.includes('Use only '+reader+' with --context headwater and --question '+profile));
    assert.match(request,/Quote the returned verified_answer exactly/);
    assert.match(request,/Call display_file for every returned display_paths entry/);
    assert.match(request,/source_citations separately using their readable titles and links/);
    assert.match(request,/Do not submit jobs/);
    assert.doesNotMatch(request,/--context tva|Case: 16–22 April 2019/);
  }
  assert.match(f.api.questionRequest('history'),/--question headwater-history/);
  assert.equal(f.api.questionRequest('unknown'),null);
});

test('next-step navigation explores the recorded cycle without preparing or executing work',()=>{
  const f=fixture();
  f.click(f.control({headwaterStageGo:'data'}));
  assert.match(f.detail.innerHTML,/<h2>Data<\/h2>/);
  assert.match(f.detail.innerHTML,/Viewing step 2 of 6 · Recorded work/);
  f.click(f.control({headwaterStageGo:'score'}));
  assert.match(f.detail.innerHTML,/<h2>Score<\/h2>/);
  assert.match(f.detail.innerHTML,/<details class="development-score-details"><summary>April case evidence<\/summary>/);
  assert.deepEqual(f.prepared,[]);assert.deepEqual(f.visited,[]);
  assert.equal(f.api.selectStage('running'),false);
});

test('known questions select matching saved-evidence explanations while unknown text retains the overview',()=>{
  const f=fixture();
  for(const q of f.api.QUESTIONS)assert.equal(f.api.evidenceTopicForRequest(f.api.questionRequest(q.id)),q.id);
  assert.equal(f.api.evidenceTopicForRequest(f.api.questionRequest('history')),'history');
  assert.equal(f.api.evidenceTopicForRequest('Could you discuss a new hypothesis?'),'overview');
  assert.equal(f.api.evidenceTopicForRequest('Background\n'+f.api.QUESTIONS[0].question),'overview');
  assert.equal(f.api.evidenceTopicForRequest(null),'overview');
  const box={innerHTML:''};
  f.api.renderContextEvidence(box,{topic:'brief'});assert.match(box.innerHTML,/Public summary · 26–27 October 2026/);assert.match(box.innerHTML,/Ask the local reader for the saved proposal and review/);assert.match(box.innerHTML,/Water4Energy_workbench.md/);assert.doesNotMatch(box.innerHTML,/HEADWATER\/blob/);
  f.api.renderContextEvidence(box,{topic:'data'});assert.match(box.innerHTML,/Supplied preparation record · 12 November 2026/);assert.match(box.innerHTML,/153 weekly examples/);
  f.api.renderContextEvidence(box,{topic:'board'});assert.match(box.innerHTML,/A dated status does not give permission/);
  f.api.renderContextEvidence(box,{topic:'history'});assert.match(box.innerHTML,/headwater-record-list/);assert.equal((box.innerHTML.match(/<time /g)||[]).length,4);
  f.api.renderContextEvidence(box,{topic:'<img src=x onerror=alert(1)>'});assert.match(box.innerHTML,/data-evidence-topic="overview"/);assert.doesNotMatch(box.innerHTML,/onerror|<img/);
});

test('project-method questions retain their roles but use the matching HEADWATER saved record',()=>{
  const f=fixture(),profiles={ledger:'headwater-ledger',proposer:'headwater-brief',critic:'headwater-brief',referee:'headwater-brief',human:'headwater-board',evidence:'headwater-score'},topics={ledger:'ledger',proposer:'brief',critic:'brief',referee:'brief',human:'board',evidence:'score'};
  for(const role of Object.keys(profiles)){
    const request=f.api.methodRequest(role);
    assert.match(request,/--context headwater/);
    assert.ok(request.includes('--question '+profiles[role]),role);
    assert.match(request,/not a newly executed role/);
    assert.match(request,/Do not submit jobs/);
    assert.match(request,/no chosen proposal is established/);
    assert.equal(f.api.evidenceTopicForRequest(request),topics[role]);
  }
  assert.equal(f.api.methodRequest('unknown'),null);
  assert.deepEqual(f.prepared,[]);
});


test('the sixth step keeps the supplied monthly downscaling example separate from the protected weekly case',()=>{
  const f=fixture();assert.equal(f.api.STAGES.length,6);
  assert.deepEqual(Array.from(f.api.contexts,c=>c.id),['headwater','lab24','tva']);
  f.api.selectStage('downscale');
  const html=f.detail.innerHTML;
  assert.match(html,/Viewing step 6 of 6/);
  assert.match(html,/all 30 days of April 2019/);
  assert.match(html,/1° field is refined to 1\/24°, about 4 km/);
  assert.match(html,/daily maximum temperature[\s\S]*precipitation/i);
  assert.match(html,/mean daily amount[\s\S]*daily 95th percentile/);
  assert.match(html,/mm\/day/);assert.match(html,/not weekly or monthly totals/);
  assert.match(html,/separate from the 16–22 April weekly Trial 0/);
  assert.match(html,/do not establish a coupled HEADWATER-to-downscaling pipeline/);
  assert.match(html,/april_2019_tmax_refine.png/);assert.match(html,/april_2019_prcp_refine.png/);
  assert.doesNotMatch(html,/tva_t2m_2019_reslim.png/);
  const request=f.api.questionRequest('downscale');
  assert.match(request,/Use only downscale.scorecard with --context headwater and --question headwater-downscale/);
  assert.equal(f.api.evidenceTopicForRequest(request),'downscale');
  const box={innerHTML:''};f.api.renderContextEvidence(box,{topic:'downscale'});
  assert.match(box.innerHTML,/Supplied maps · April 2019 · 30 days/);
  assert.match(box.innerHTML,/Download figure/);assert.match(box.innerHTML,/dali-figures-provenance.json/);
  assert.deepEqual(f.prepared,[]);
});

test('saved comparison figures expose correct model families and provenance without replacing the approved April map',()=>{
  const f=fixture(),html=f.api.comparisonFiguresHTML();
  assert.match(html,/<details class="development-score-details development-visual-evidence"><summary>/);
  assert.match(html,/not the 24 October soil-residual test result/);
  assert.match(html,/CNN neighborhood sizes: 1×1, 3×3 and 9×9/);
  assert.match(html,/different comparison from the Reslim figures/);
  assert.match(html,/d0199a817ddbfa0fbf65c9e81d9fcc53081611ee/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.equal(f.api.suppliedFigureHTML('unknown'),'');
  assert.doesNotMatch(html,/water4energy-april-2019-score.png/);
});
