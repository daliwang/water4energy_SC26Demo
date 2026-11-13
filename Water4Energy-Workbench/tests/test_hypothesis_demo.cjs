// The values below are isolated contract fixtures, never bundled as demo results.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const demo=require('../public/hypothesis-demo.js');
const definition=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/demo-case.json'),'utf8'));
const fixed={start:'2019-04-16',end:'2019-04-22',issued:'2019-04-15'};
function fixture(){
  const panels={};
  for(const id of ['temperature','precipitation'])panels[id]={kind:'frozen_prediction',model:'det_v2_soil_k9',figure:id+'.png',source_file:'realization.json',source:'Contract fixture only'};
  panels.runoff={kind:'observation',dataset:'ERA5',variable:'sro',forecast_available:false,figure:'runoff.png',source_file:'realization.json',source:'Contract fixture only'};
  panels.downscale={kind:'frozen_comparison',trial:'Trial 0',scored:'2026-09-07',input_resolution_deg:1,output_resolution_deg:0.25,date:'2019-04-19',figure:'comparison.png',source_file:'scorecard.json',source:'Contract fixture only'};
  return {schema_version:1,case:{...fixed},panels};
}
const files=['temperature.png','precipitation.png','runoff.png','comparison.png','realization.json','scorecard.json','readout.json'].map(name=>({name,size:100}));

test('only the fixed issue and valid week match the demo',()=>{
  assert.equal(demo.matchesCase(fixed),true);
  assert.equal(demo.matchesCase({...fixed,issued:'2019-04-16'}),false);
  assert.equal(demo.dateInCase('2019-04-19'),true);
  assert.equal(demo.dateInCase('2019-04-23'),false);
  const data=fixture();data.case.start='2010-01-04';
  const result=demo.validateManifest(data,files);
  assert.equal(result.matched,false);
  assert.ok(Object.values(result.panels).every(panel=>!panel.available));
});
test('matching metadata requires existing figures and backing source JSON',()=>{
  let data=fixture(),result=demo.validateManifest(data,files);
  assert.equal(result.matched,true);
  assert.equal(Object.values(result.panels).filter(panel=>panel.available).length,4);
  result=demo.validateManifest(data,files.filter(file=>file.name!=='realization.json'));
  assert.equal(result.panels.temperature.available,false);
  assert.equal(result.panels.downscale.available,true);
  data=fixture();data.example_only=true;
  assert.equal(demo.validateManifest(data,files).matched,false);
});
test('runoff cannot be mislabeled as a forecast or a different data source',()=>{
  for(const change of [{kind:'forecast'},{dataset:'HEADWATER'},{forecast_available:true},{variable:'runoff'}]){
    const data=fixture();Object.assign(data.panels.runoff,change);
    assert.equal(demo.validateManifest(data,files).panels.runoff.available,false);
  }
});
test('downscale requires the frozen comparison and an in-week figure date',()=>{
  for(const change of [{date:'2018-01-19'},{output_resolution_deg:0.01},{trial:'Trial 1'},{scored:'2026-11-08'}]){
    const data=fixture();Object.assign(data.panels.downscale,change);
    assert.equal(demo.validateManifest(data,files).panels.downscale.available,false);
  }
});
test('unsafe and ambiguous output references cannot enter evidence cards',()=>{
  for(const name of ['/tmp/file.png','../file.png','a/../file.png','https://example.com/x.png','a%2fb.png','a\\b.png','a\u0000.png'])assert.equal(demo.validPath(name),false,name);
  assert.equal(demo.validPath('figures/case figure.png'),true);
  const data=fixture();data.panels.temperature.figure='../temperature.png';
  assert.equal(demo.validateManifest(data,files).panels.temperature.available,false);
});
test('required skills use exact names and separate the optional dam skill',()=>{
  const response={project:definition.project,project_found:true,count:3,skills:[{name:'lab.ledger'},{name:'lab.ledger-extra'},{name:'dam.readout'}]};
  const result=demo.skillReadiness(response,definition.project);
  assert.equal(result.loaded,1);
  assert.equal(result.optional,'loaded');
  assert.equal(result.required.length,8);
  assert.equal(demo.skillReadiness({...response,project:'Other'},definition.project).known,false);
  assert.equal(demo.skillReadiness({project:definition.project,project_found:false,count:null},definition.project).loaded,null);
});
test('a ready index does not imply all six lead sources are present',()=>{
  const knowledge={project:definition.project,project_found:true,count:1,ready_count:1,all_ready:true,knowledge_bases:[{build_status:'ready',ready:true,documents:[{filename:'README.md',title:'Unrelated README',index_status:'indexed'},{filename:'TVA_AGENT_DEMO_PLAN_20261102.md',index_status:'indexed'}]}]};
  const coverage=demo.knowledgeCoverage(knowledge,definition.sources,definition.project);
  assert.equal(coverage.listed,1);
  assert.equal(coverage.rows.find(row=>row.source.id==='readme').state,'not-listed');
  assert.equal(coverage.rows.find(row=>row.source.id==='plan').state,'listed-ready-index');
  assert.equal(demo.knowledgeCoverage({...knowledge,project:'Other'},definition.sources,definition.project).listed,null);
  const rebuilding=JSON.parse(JSON.stringify(knowledge));rebuilding.knowledge_bases[0].ready=false;
  assert.equal(demo.knowledgeCoverage(rebuilding,definition.sources,definition.project).rows.find(row=>row.source.id==='plan').state,'listed');
});
test('current VISTA kebab-case names map only to the exact eight demo contracts',()=>{
  const names=['lab-literature','lab-download','lab-ledger','lab-board','lab-design','lab-show-command','lab-realize','downscale-scorecard'];
  const result=demo.skillReadiness({project:definition.project,project_found:true,count:8,skills:names.map(name=>({name}))},definition.project);
  assert.equal(result.loaded,8);
  assert.equal(result.optional,'missing');
  const unrelated=demo.skillReadiness({project:definition.project,project_found:true,count:2,skills:[{name:'lab-ledger-extra'},{name:'tva-weekly-inflow-path2'}]},definition.project);
  assert.equal(unrelated.loaded,0);
});
test('indexed descriptive Markdown filenames identify lead sources without accepting a generic README',()=>{
  const documents=['HEADWATER_hypothesis_lab.md','Where_the_hypothesis_lab_runs.md','TVA_AGENT_DEMO_PLAN_20261102.md','TVA_Task3_Briefing_Summary_20260915.md','Trial_0_scorecard_7_September_2026.md','April_2019_ledger_excerpt.md'].map(filename=>({filename,title:filename,index_status:'indexed'}));
  const knowledge={project:definition.project,project_found:true,count:1,knowledge_bases:[{ready:true,documents}]};
  const result=demo.knowledgeCoverage(knowledge,definition.sources,definition.project);
  assert.equal(result.listed,6);
  assert.ok(result.rows.every(row=>row.state==='listed-ready-index'));
  assert.equal(demo.sourceMatches(definition.sources[0],{filename:'README.md',title:'README.md'}),false);
});
test('the dam readout stays unavailable until explicitly enabled with matching rule and source',()=>{
  const manifestation=demo.validateManifest(fixture(),files);
  const selection={enabled:false,reservoir:'Normandy',rule:'Agreed test rule'};
  const readout={case:{...fixed},reservoir:'Normandy',rule:'Agreed test rule',decision:'hold',realization_source_file:'realization.json'};
  assert.equal(demo.validateDamReadout(readout,selection,manifestation).available,false);
  selection.enabled=true;
  assert.equal(demo.validateDamReadout(readout,selection,manifestation).available,true);
  assert.equal(demo.validateDamReadout({...readout,decision:'release'},selection,manifestation).available,false);
  assert.equal(demo.validateDamReadout({...readout,reservoir:'Norris'},selection,manifestation).available,false);
  assert.equal(demo.validateDamReadout({...readout,rule:'A different rule'},selection,manifestation).available,false);
  assert.equal(demo.validateDamReadout({...readout,realization_source_file:'unrelated.json'},selection,manifestation).available,false);
  assert.equal(demo.validateDamReadout({...readout,case:{...fixed,end:'2019-04-23'}},selection,manifestation).available,false);
  const invalid=fixture();
  invalid.panels.temperature.model='unknown';invalid.panels.precipitation.model='unknown';invalid.panels.runoff.kind='forecast';
  assert.equal(demo.validateDamReadout(readout,selection,demo.validateManifest(invalid,files)).available,false);
});

function refreshHarness(provider) {
  const context=vm.createContext({module:{exports:{}},document:{querySelector:()=>null}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/hypothesis-demo.js'),'utf8'),context);
  const instance=context.module.exports;
  const outputBase='/api/vista/projects/'+definition.project+'/outputs';
  instance.init({caseDefinition:definition,projectUrl:suffix=>'/api/vista/projects/'+definition.project+suffix,api:provider});
  return {instance,outputBase,refresh:(next={})=>instance.refresh({project:definition.project,status:{project_found:true},...next})};
}
test('project capabilities update without April output reads and survive a case reset, with kebab-case skill aliases',()=>{
  const containers=Object.fromEntries(['#required-skills','#demo-readiness','#demo-sources'].map(id=>[id,{innerHTML:''}]));
  const context=vm.createContext({module:{exports:{}},document:{querySelector:selector=>containers[selector]||null}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/hypothesis-demo.js'),'utf8'),context);
  const instance=context.module.exports;let outputReads=0;
  instance.init({caseDefinition:definition,projectUrl:suffix=>'/api/vista/projects/'+definition.project+suffix,api:()=>{outputReads++;throw new Error('Capabilities must not read case outputs');}});
  const skills={project:definition.project,project_found:true,count:8,skills:definition.requiredSkills.map(skill=>({name:skill.id.replace(/[._]/g,'-')}))};
  const knowledge={project:definition.project,project_found:true,count:9,ready_count:9,knowledge_bases:definition.sources.map(source=>({ready:true,documents:[{filename:source.paths[0],index_status:'indexed'}]}))};
  const result=instance.updateCapabilities({project:definition.project,status:{project_found:true},skills,knowledge});
  assert.equal(result.loaded,8);assert.match(containers['#demo-readiness'].innerHTML,/8 \/ 8 loaded/);assert.match(containers['#demo-readiness'].innerHTML,/9 \/ 9 indexes ready/);
  assert.equal((containers['#required-skills'].innerHTML.match(/class="demo-badge loaded"/g)||[]).length,8);
  assert.doesNotMatch(containers['#required-skills'].innerHTML,/Unknown/);
  instance.reset();assert.equal(outputReads,0);
  assert.equal((containers['#required-skills'].innerHTML.match(/class="demo-badge loaded"/g)||[]).length,8);
  instance.updateCapabilities({project:'Other project',status:{project_found:true},skills,knowledge});
  assert.match(containers['#required-skills'].innerHTML,/Unknown/);assert.doesNotMatch(containers['#required-skills'].innerHTML,/class="demo-badge loaded"/);
  assert.equal(outputReads,0);
});
function researchFixture() {
  const manifest=fixture();
  manifest.research={ledger_file:'records/ledger April.json',proposal_file:'review/proposal.md',critic_file:'review/critic.md',referee_file:'review/referee.md',protocol_file:'review/human protocol.md'};
  return {manifest,listing:[...files,{name:definition.manifest,size:100},...Object.values(manifest.research).map(name=>({name,size:100}))]};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('refresh returns actual research references as encoded links scoped to the current output store',async()=>{
  const {manifest,listing}=researchFixture();
  manifest.research.unrecognized_file='not-a-research-step.md';
  manifest.research.url='https://example.com/untrusted';
  listing.push({name:'not-a-research-step.md',size:100});
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?listing:manifest);
  const result=await harness.refresh();
  assert.equal(result.matched,true);
  assert.deepEqual(plain(result.researchLinks),[
    {step:'ledger',name:'records/ledger April.json',url:harness.outputBase+'/records/ledger%20April.json'},
    {step:'proposer',name:'review/proposal.md',url:harness.outputBase+'/review/proposal.md'},
    {step:'critic',name:'review/critic.md',url:harness.outputBase+'/review/critic.md'},
    {step:'referee',name:'review/referee.md',url:harness.outputBase+'/review/referee.md'},
    {step:'human',name:'review/human protocol.md',url:harness.outputBase+'/review/human%20protocol.md'},
  ]);
});

test('research references require existing safe names and a matching non-example manifest',async()=>{
  let data=researchFixture();
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?data.listing:data.manifest);
  for(const name of ['../ledger.json','/ledger.json','https://example.com/ledger.json','a%2fledger.json','a\\ledger.json','a?ledger.json','a#ledger.json','a\u0000.json']) {
    data=researchFixture();data.manifest.research={ledger_file:name};data.listing.push({name,size:100});
    assert.deepEqual(plain((await harness.refresh()).researchLinks),[],name);
  }
  data=researchFixture();data.manifest.research={ledger_file:'absent.json'};
  assert.deepEqual(plain((await harness.refresh()).researchLinks),[]);
  for(const change of [{schema_version:2},{case:{...fixed,start:'2019-04-17'}},{example_only:true}]) {
    data=researchFixture();Object.assign(data.manifest,change);
    const result=await harness.refresh();
    assert.equal(result.matched,false);
    assert.deepEqual(plain(result.researchLinks),[]);
    assert.deepEqual(plain(result.caseFigures),[]);
  }
});

test('unavailable project, missing manifest and read failure explicitly clear prior research links',async()=>{
  const data=researchFixture();let mode='valid';
  const harness=refreshHarness(async url=>{
    if(mode==='failed')throw new Error('QA fixture unavailable');
    if(url.endsWith('/outputs'))return mode==='missing'?files:data.listing;
    return data.manifest;
  });
  for(const unavailable of [
    ()=>harness.refresh({project:'Other project'}),
    ()=>harness.refresh({status:{project_found:false}}),
    ()=>{mode='missing';return harness.refresh();},
    ()=>{mode='failed';return harness.refresh();},
  ]) {
    mode='valid';const prior=await harness.refresh();
    assert.equal(prior.researchLinks.length,5);
    assert.equal(prior.caseFigures.length,4);
    const result=await unavailable();
    assert.equal(result.matched,false);
    assert.deepEqual(plain(result.researchLinks),[]);
    assert.deepEqual(plain(result.caseFigures),[]);
  }
});

test('a superseded output read cannot replace a newer set of research links',async()=>{
  const data=researchFixture();let release,reads=0;
  const harness=refreshHarness(async url=>{
    if(url.endsWith('/outputs')) {
      if(++reads===1)return new Promise(resolve=>{release=resolve;});
      return data.listing;
    }
    return data.manifest;
  });
  const previous=harness.refresh();
  const current=await harness.refresh();
  assert.equal(current.researchLinks.length,5);
  assert.equal(current.caseFigures.length,4);
  release(data.listing);
  assert.equal(await previous,null);
});

test('case figures carry canonical labels and actual scoped raster and JSON references',async()=>{
  const {manifest,listing}=researchFixture();
  const record=manifest.panels.temperature;
  Object.assign(record,{figure:'figures/temperature April.png',source_file:'data/realization April.json',title:'Untrusted replacement title'});
  listing.push({name:record.figure,size:100},{name:record.source_file,size:100});
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?listing:manifest);
  const result=await harness.refresh();
  assert.deepEqual(plain(result.caseFigures).map(item=>[item.id,item.kind]),[
    ['temperature','frozen_prediction'],['precipitation','frozen_prediction'],['runoff','observation'],['downscale','frozen_comparison'],
  ]);
  const panel=definition.panels.find(item=>item.id==='temperature');
  assert.deepEqual(plain(result.caseFigures[0]),{
    id:'temperature',title:panel.title,subtitle:panel.subtitle,kind:'frozen_prediction',
    figure:record.figure,figureUrl:harness.outputBase+'/figures/temperature%20April.png?preview=true',
    sourceFile:record.source_file,sourceUrl:harness.outputBase+'/data/realization%20April.json',source:record.source,
  });
});

test('unsupported scientific kinds never enter the case gallery even when image files exist',async()=>{
  const {manifest,listing}=researchFixture();
  manifest.panels.temperature.kind='observation';
  manifest.panels.precipitation.model='new-model';
  manifest.panels.runoff.forecast_available=true;
  manifest.panels.downscale.trial='Trial 1';
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?listing:manifest);
  const result=await harness.refresh();
  assert.equal(result.matched,true);
  assert.equal(result.available,0);
  assert.deepEqual(plain(result.caseFigures),[]);
});

test('case gallery excludes unsafe, missing and active-format references while retaining valid panels',async()=>{
  let data=researchFixture();
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?data.listing:data.manifest);
  for(const change of [
    {figure:'../temperature.png'},
    {figure:'https://example.com/temperature.png'},
    {figure:'not-listed.png'},
    {figure:'active.svg'},
    {source_file:'missing.json'},
    {source_file:'not-json.md'},
  ]) {
    data=researchFixture();Object.assign(data.manifest.panels.temperature,change);
    if(change.figure==='active.svg')data.listing.push({name:'active.svg',size:100});
    if(change.source_file==='not-json.md')data.listing.push({name:'not-json.md',size:100});
    const result=await harness.refresh();
    assert.deepEqual(plain(result.caseFigures).map(item=>item.id),['precipitation','runoff','downscale'],JSON.stringify(change));
  }
  data=researchFixture();data.listing=data.listing.filter(file=>file.name!=='temperature.png');
  assert.equal((await harness.refresh()).caseFigures.some(item=>item.id==='temperature'),false);
});

test('orphan output images cannot become case figures without validated panel associations',async()=>{
  const {manifest,listing}=researchFixture();
  manifest.panels={};listing.push({name:'orphan.png',size:100});
  const harness=refreshHarness(async url=>url.endsWith('/outputs')?listing:manifest);
  const result=await harness.refresh();
  assert.equal(result.matched,true);
  assert.deepEqual(plain(result.caseFigures),[]);
});
