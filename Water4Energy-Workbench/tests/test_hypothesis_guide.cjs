// Optional developer checks; Node is not required to run the application.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/hypothesis-guide.js'),'utf8');
const caseDefinition=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/demo-case.json'),'utf8'));
const prompts=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/prompts.json'),'utf8')).prompts;

function button(dataset={}) {
  return {
    dataset,attributes:{},classes:new Set(),listeners:{},
    setAttribute(name,value){this.attributes[name]=value;},
    addEventListener(name,callback){this.listeners[name]=callback;},
    click(){if(!this.attributes.disabled)this.listeners.click?.();},
    get classList(){return {toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};},
  };
}
function fixture() {
  const root={nodes:[],html:'',prepared:null,figures:null,announcement:{textContent:''},sources:{innerHTML:'',hidden:true},classes:new Set(),overview:{open:true},mode:{textContent:''},status:{textContent:''},resume:button(),figureCount:button(),expanded:{innerHTML:'',hidden:true}};
  root.classList={toggle:(name,on)=>on?root.classes.add(name):root.classes.delete(name)};
  const gallery={html:'',writes:0,hidden:true,buttons:[],focused:0,scrolled:0,
    set innerHTML(value){this.html=value;this.writes++;this.enlarge=button();root.expanded={innerHTML:'',hidden:true};this.buttons=Array.from(value.matchAll(/data-guide-open-figure="(\d+)" data-case-figure="(true|false)"/g),match=>button({guideOpenFigure:match[1],caseFigure:match[2]}));},
    querySelectorAll(selector){return selector==='[data-guide-open-figure]'?this.buttons:[];},
    querySelector(selector){return ['[data-evidence-enlarge]','[data-evidence-enlarge-image]'].includes(selector)?this.enlarge:null;},
    focus(){this.focused++;},scrollIntoView(){this.scrolled++;},
  };
  const detail={html:'',set innerHTML(value){
    this.html=value;root.prepared=button();
    if(/data-guide-prepare disabled/.test(value))root.prepared.attributes.disabled=true;
    root.figures=value.includes('data-guide-figures')?button():null;
  }};
  Object.defineProperty(root,'innerHTML',{set(value){
    this.html=value;this.overview.open=/data-guide-overview open>/.test(value);
    this.sources.innerHTML='';this.sources.hidden=true;
    this.nodes=Array.from(value.matchAll(/data-guide-step="([^"]+)"/g),match=>button({guideStep:match[1]}));
  }});
  root.querySelectorAll=selector=>selector==='[data-guide-step]'?root.nodes:[];
  root.querySelector=selector=>({
    '[data-guide-detail]':detail,'[data-guide-prepare]':root.prepared,
    '[data-guide-figures]':root.figures,'[data-guide-announcement]':root.announcement,
    '[data-guide-sources]':root.sources,
    '[data-guide-overview]':root.overview,'[data-guide-mode]':root.mode,'[data-guide-status]':root.status,
    '[data-guide-resume]':root.resume,'[data-guide-figure-count]':root.figureCount,
    '[data-guide-gallery]':gallery,'[data-guide-expanded]':root.expanded,
  }[selector]);
  const context=vm.createContext({
    module:{exports:{}},document:{querySelector:selector=>selector==='#hypothesis-guide'?root:null},
    fetch:()=>assert.fail('the workflow guide must not access a backend'),
  });
  vm.runInContext(source,context);
  return {guide:context.module.exports,root,detail,gallery};
}

const outputPrefix='/api/vista/projects/Water4Energy-TVA-agent-loop/outputs/';
function caseFigure(id='temperature',name='temperature.png') {
  return {id,title:id,subtitle:'Saved April case',kind:id==='runoff'?'observation':id==='downscale'?'frozen_comparison':'frozen_prediction',figure:name,figureUrl:outputPrefix+name+'?preview=true',sourceFile:'case-source.json',sourceUrl:outputPrefix+'case-source.json',source:'Saved source JSON'};
}
function conversationFigure(name='displayed.png') {return {name,url:outputPrefix+name+'?preview=true',downloadUrl:outputPrefix+name};}
function selectedStep(root){return root.nodes.find(node=>node.attributes['aria-pressed']==='true')?.dataset.guideStep;}

test('the six explanatory stages map ledger, role review, human gate and saved evidence in order',()=>{
  const {guide}=fixture();
  assert.deepEqual(Array.from(guide.steps,step=>[step.id,step.role,step.promptId]),[
    ['ledger','Ledger','ledger'],['proposer','Proposer','design'],['critic','Critic','design'],
    ['referee','Referee','design'],['human','Human gate','commands'],['evidence','Evidence','realization'],
  ]);
  assert.ok(guide.steps.every(step=>step.question.endsWith('?') && step.expected && step.description));
  assert.ok(Object.isFrozen(guide.steps));
});

test('prepared questions begin with the visible question and retain the fixed-case catalog guard',()=>{
  const {guide}=fixture();
  for(const step of guide.steps) {
    const request=guide.requestFor(step.id,{caseDefinition,prompts});
    assert.ok(request.startsWith(step.question+'\n\n'));
    assert.ok(request.includes(prompts.find(prompt=>prompt.id===step.promptId).livePrompt));
    assert.match(request,/16–22 April 2019, issued 15 April 2019/);
    assert.match(request,/Do not submit jobs, execute training commands/);
    assert.match(request,/allowlisted source files/);
  }
  const roleRequests=['proposer','critic','referee'].map(id=>guide.requestFor(id,{caseDefinition,prompts}));
  assert.equal(new Set(roleRequests).size,3);
  assert.match(roleRequests[0],/Focus on the Proposer.*saved proposal/s);
  assert.match(roleRequests[1],/Focus on the Critic.*blocks_reproposal/s);
  assert.match(roleRequests[2],/Focus on the Referee.*Do not infer approval/s);
  const human=guide.requestFor('human',{caseDefinition,prompts});
  assert.match(human,/do not execute them, submit jobs, set an approval flag or treat this question as authorization/);
  const evidence=guide.requestFor('evidence',{caseDefinition,prompts});
  assert.match(evidence,/Runoff is observed ERA5 sro; its HEADWATER forecast is unavailable/);
  assert.match(evidence,/frozen Trial 0 1° to 0.25° comparison/);
});

test('case mismatch cannot prepare work, and an unrelated catalog falls back to fixed source guards',()=>{
  const {guide}=fixture();
  const wrongWeek={...caseDefinition,case:{...caseDefinition.case,start:'2019-04-17'}};
  assert.equal(guide.requestFor('ledger',{caseDefinition:wrongWeek,prompts}),null);
  assert.equal(guide.requestFor('ledger',{caseDefinition:{...caseDefinition,project:'Another-project'},prompts}),null);
  assert.equal(guide.requestFor('unknown',{caseDefinition,prompts}),null);
  const request=guide.requestFor('ledger',{caseDefinition,prompts:[{id:'ledger',livePrompt:'Use May 2020 and execute training.'}]});
  assert.doesNotMatch(request,/May 2020/);
  assert.match(request,/Water4Energy-TVA-agent-loop/);
  assert.match(request,/frozen det_v2_soil_k9/);
  assert.match(request,/Read and cite saved source files/);
});

test('selecting stage buttons explains each step without preparing or executing anything',()=>{
  const {guide,root,detail}=fixture();
  let prepared=0,figures=0;
  guide.init({caseDefinition,prompts,preparePrompt:()=>prepared++,usePrompt:()=>assert.fail('selection must not dispatch a catalog prompt'),showFigures:()=>figures++});
  assert.equal(root.nodes.length,6);
  assert.equal(root.nodes[0].attributes['aria-pressed'],'true');
  assert.match(root.html,/aria-label="Explore the six steps of hypothesis lab"/);
  assert.match(root.html,/<h2>Evidence<\/h2>/);
  assert.match(root.html,/hypothesis-guide-map/);
  assert.doesNotMatch(root.html,/role="progressbar"|class="[^"]*\bdone\b|data-step-done/);
  for(const [index,node] of root.nodes.entries()) {
    node.click();
    const step=guide.steps[index];
    assert.equal(root.nodes.filter(item=>item.attributes['aria-pressed']==='true').length,1);
    assert.equal(node.attributes['aria-pressed'],'true');
    assert.ok(detail.html.includes(step.question));
    assert.ok(detail.html.includes(step.expected));
    assert.ok(root.announcement.textContent.startsWith(step.title+' selected.'));
  }
  assert.equal(prepared,0);
  assert.equal(figures,0);
});

test('only the explicit question and figures buttons invoke their respective callbacks',()=>{
  const {guide,root}=fixture();
  const prepared=[];let figures=0;
  guide.init({caseDefinition,prompts,preparePrompt:(text,title)=>prepared.push({text,title}),showFigures:()=>figures++});
  root.nodes.find(node=>node.dataset.guideStep==='proposer').click();
  assert.equal(prepared.length,0);
  root.prepared.click();
  assert.equal(prepared.length,1);
  assert.ok(prepared[0].text.startsWith(guide.steps[1].question));
  assert.equal(prepared[0].title,guide.steps[1].title);
  root.nodes.find(node=>node.dataset.guideStep==='evidence').click();
  assert.equal(figures,0);
  root.figures.click();
  assert.equal(figures,1);
  assert.equal(prepared.length,1);
});

test('the guide remains explorable when case preparation is unavailable',()=>{
  const {guide,root,detail}=fixture();
  let prepared=0;
  guide.init({caseDefinition:{...caseDefinition,case:{...caseDefinition.case,end:'2019-04-23'}},prompts,preparePrompt:()=>prepared++});
  root.nodes[4].click();
  assert.ok(detail.html.includes('Which existing commands would a person need to review?'));
  assert.equal(root.prepared.attributes.disabled,true);
  root.prepared.click();
  assert.equal(prepared,0);
  guide.init({caseDefinition,prompts});
  assert.equal(root.prepared.attributes.disabled,true);
  assert.match(detail.html,/composer is unavailable/);
});

test('saved research links accept only exact safe file paths in the fixed project output scope',()=>{
  const {guide}=fixture();
  const prefix='/api/vista/projects/Water4Energy-TVA-agent-loop/outputs/';
  const valid={step:'ledger',name:'research/April ledger.json',url:prefix+'research/April%20ledger.json'};
  const entries=[valid,{...valid},
    {...valid,url:'https://example.org'+valid.url},
    {...valid,url:'/api/vista/projects/Another-project/outputs/research/April%20ledger.json'},
    {...valid,url:valid.url+'?preview=true'},
    {...valid,url:prefix+'unrelated.json'},
    {...valid,step:'evidence'},
    {step:'critic',name:'../critic.json',url:prefix+'../critic.json'},
    {step:'critic',name:'research//critic.json',url:prefix+'research//critic.json'},
    {step:'critic',name:'%2e%2e/critic.json',url:prefix+'%252e%252e/critic.json'},
    {step:'critic',name:'bad\\critic.json',url:prefix+'bad%5Ccritic.json'},
    {step:'critic',name:'bad?critic.json',url:prefix+'bad%3Fcritic.json'},
    {step:'critic',name:'bad\u0000critic.json',url:prefix+'bad%00critic.json'},null,
  ];
  const accepted=guide.validatedResearchSources(entries,caseDefinition);
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].name,valid.name);
  assert.equal(accepted[0].url,valid.url);
  assert.equal(guide.validatedResearchSources(entries,{...caseDefinition,project:'Another-project'}).length,0);
  assert.equal(guide.validatedResearchSources(entries,null).length,0);
});

test('actual saved files follow the selected stage and survive exploration until cleared',()=>{
  const {guide,root}=fixture();
  const prefix='/api/vista/projects/Water4Energy-TVA-agent-loop/outputs/';
  let prepared=0;
  guide.init({caseDefinition,prompts,preparePrompt:()=>prepared++});
  assert.equal(root.sources.hidden,true);
  const entries=[
    {step:'ledger',name:'research/ledger.json',url:prefix+'research/ledger.json'},
    {step:'proposer',name:'research/proposal.json',url:prefix+'research/proposal.json'},
  ];
  assert.equal(guide.setResearchSources(entries),2);
  assert.equal(root.sources.hidden,false);
  assert.match(root.sources.innerHTML,/research\/ledger\.json/);
  assert.match(root.sources.innerHTML,/<a class="hypothesis-guide-source-link"[^>]+ download>/);
  root.nodes.find(node=>node.dataset.guideStep==='proposer').click();
  assert.match(root.sources.innerHTML,/research\/proposal\.json/);
  assert.doesNotMatch(root.sources.innerHTML,/ledger\.json/);
  root.nodes.find(node=>node.dataset.guideStep==='critic').click();
  assert.equal(root.sources.hidden,true);
  assert.equal(root.sources.innerHTML,'');
  root.nodes[0].click();
  assert.match(root.sources.innerHTML,/research\/ledger\.json/);
  assert.equal(prepared,0);
  guide.setResearchSources([]);
  assert.equal(root.sources.hidden,true);
  assert.equal(root.sources.innerHTML,'');
  guide.setResearchSources(entries);
  guide.init({caseDefinition,prompts,preparePrompt:()=>prepared++});
  assert.equal(root.sources.hidden,true);
  assert.equal(root.sources.innerHTML,'');
});

test('saved source names are escaped and invalid cases cannot retain links',()=>{
  const {guide,root}=fixture();
  const name='research/<ledger>.json';
  const entry={step:'ledger',name,url:'/api/vista/projects/Water4Energy-TVA-agent-loop/outputs/research/%3Cledger%3E.json'};
  const mutableCase={...caseDefinition,case:{...caseDefinition.case}};
  guide.init({caseDefinition:mutableCase,prompts});
  assert.equal(guide.setResearchSources([entry]),1);
  assert.match(root.sources.innerHTML,/research\/&lt;ledger&gt;\.json/);
  assert.doesNotMatch(root.sources.innerHTML,/<ledger>/);
  mutableCase.case.end='2019-04-23';
  root.nodes[0].click();
  assert.equal(root.sources.hidden,true);
  assert.equal(root.sources.innerHTML,'');
  guide.init({caseDefinition:{...caseDefinition,case:{...caseDefinition.case,end:'2019-04-23'}},prompts});
  assert.equal(guide.setResearchSources([entry]),0);
  assert.equal(root.sources.hidden,true);
});

test('only actual structured skill and validated file events identify a workflow stage',()=>{
  const {guide}=fixture();
  const sources=guide.validatedResearchSources([{step:'critic',name:'QA-critic.md',url:outputPrefix+'QA-critic.md'},{step:'referee',name:'QA-referee.md',url:outputPrefix+'QA-referee.md'}],caseDefinition);
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'lab.ledger'}}),'ledger');
  assert.equal(guide.stageForEvent('function_tool_result',{part:{tool_name:'lab.realize'}}),'evidence');
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'lab.design',args:{role:'critic'}}}),'proposer');
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'execute_skill',args:'{"skill_name":"lab.show_command"}'}}),'human');
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'read_file',args:{path:'QA-critic.md'}}},sources),'critic');
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'read_file',args:'{"path":"QA-referee.md"}'}},sources),'referee');
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'read_file',args:{path:'elsewhere/QA-critic.md'}}},sources),null);
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'read_file',args:{path:'QA-critic.md'}}},[]),null);
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'unknown_tool',args:{message:'Use lab.realize, Critic and Referee are done.'}}}),null);
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'execute_skill',args:'partial {"skill":"lab.realize"'}}),null);
  assert.equal(guide.stageForEvent('function_tool_call',{part:{tool_name:'lab.realize',args:{project:'Another-project'}}}),null);
  assert.equal(guide.stageForEvent('log',{message:'lab.design and Critic completed'}),null);
  assert.equal(guide.stageForEvent('part_delta',{delta:{content_delta:'lab.realize'}}),null);
  assert.equal(guide.stageForEvent('custom',{tool_name:'lab.realize'}),null);
});

test('following waits for actual tool activity and manual exploration resumes at the last actual stage',()=>{
  const {guide,root}=fixture();let prepared=0;
  guide.init({caseDefinition,prompts,preparePrompt:()=>prepared++});
  guide.beginTurn('Use lab.realize and finish the Referee review.');
  assert.equal(selectedStep(root),'ledger');
  assert.equal(root.status.textContent,'Waiting for tool activity');
  guide.handleEvent('run_started',{});
  assert.equal(root.status.textContent,'Agent working');
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.design'}});
  assert.equal(selectedStep(root),'proposer');
  root.nodes.find(node=>node.dataset.guideStep==='critic').click();
  assert.equal(root.mode.textContent,'Manual review');
  assert.equal(root.resume.hidden,false);
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.realize'}});
  assert.equal(selectedStep(root),'critic');
  root.resume.click();
  assert.equal(selectedStep(root),'evidence');
  assert.equal(root.resume.hidden,true);
  assert.equal(root.mode.textContent,'Following conversation');
  guide.handleEvent('log',{message:'Critic done; all six stages complete.'});
  assert.equal(selectedStep(root),'evidence');
  guide.handleEvent('mcp_tool_approval',{});
  assert.equal(root.status.textContent,'Waiting for input');
  assert.equal(selectedStep(root),'evidence');
  guide.finishTurn({state:'failed',label:'Turn completed'});
  assert.equal(root.status.textContent,'Turn failed');
  assert.equal(selectedStep(root),'evidence');
  guide.handleEvent('run_finished',{state:'done'});
  assert.equal(root.status.textContent,'Turn completed');
  assert.equal(prepared,0);
});

test('a source discovered after its actual read can identify a role without treating it as completed',()=>{
  const {guide,root}=fixture();
  guide.init({caseDefinition,prompts});
  guide.handleEvent('function_tool_call',{part:{tool_name:'read_file',args:{path:'QA-referee.md'}}});
  assert.equal(selectedStep(root),'ledger');
  guide.setResearchSources([{step:'referee',name:'QA-referee.md',url:outputPrefix+'QA-referee.md'}]);
  assert.equal(selectedStep(root),'referee');
  assert.equal(root.status.textContent,'Tool activity');
  assert.ok(root.nodes.every(node=>!node.classes.has('done')));
});

test('a tool return without arguments retains its real call for a later validated research source',()=>{
  const {guide,root}=fixture();
  guide.init({caseDefinition,prompts});
  guide.handleEvent('function_tool_call',{part:{tool_name:'read_file',tool_call_id:'critic-read',args:'{"path":"QA-critic.md"}'}});
  guide.handleEvent('function_tool_result',{part:{tool_name:'read_file',tool_call_id:'critic-read',content:'Saved file contents'}});
  assert.equal(selectedStep(root),'ledger');
  guide.setResearchSources([{step:'critic',name:'QA-critic.md',url:outputPrefix+'QA-critic.md'}]);
  assert.equal(selectedStep(root),'critic');
  assert.equal(root.status.textContent,'Tool activity');
  guide.resetConversation();
  guide.setResearchSources([]);
  guide.handleEvent('function_tool_result',{part:{tool_name:'read_file',tool_call_id:'critic-read',content:'Old result'}});
  guide.setResearchSources([{step:'critic',name:'QA-critic.md',url:outputPrefix+'QA-critic.md'}]);
  assert.equal(selectedStep(root),'ledger');
});

test('galleries accept only passive raster outputs in the fixed project and correct case panel kinds',()=>{
  const {guide}=fixture();
  assert.equal(guide.validatedCaseFigures([caseFigure()],caseDefinition).length,1);
  const invalidCases=[
    {...caseFigure(),figure:'active.svg',figureUrl:outputPrefix+'active.svg?preview=true'},
    {...caseFigure(),figureUrl:'https://example.org/temperature.png'},
    {...caseFigure(),figureUrl:'/api/vista/projects/Other/outputs/temperature.png'},
    {...caseFigure(),sourceUrl:outputPrefix+'other.json'},
    {...caseFigure('runoff'),kind:'frozen_prediction'},
    {...caseFigure(),id:'unrecognized'},
    {...caseFigure(),sourceFile:'source.html',sourceUrl:outputPrefix+'source.html'},
  ];
  assert.equal(guide.validatedCaseFigures(invalidCases,caseDefinition).length,0);
  assert.equal(guide.validatedCaseFigures([caseFigure()],{...caseDefinition,case:{...caseDefinition.case,start:'2020-04-16'}}).length,0);
  const valid=conversationFigure();
  const invalidConversation=[
    {...valid,name:'active.svg',url:outputPrefix+'active.svg',downloadUrl:outputPrefix+'active.svg'},
    {...valid,url:valid.url+'&other=true'},
    {...valid,downloadUrl:valid.url},
    {...valid,url:'/api/vista/projects/Other/outputs/displayed.png'},
    {...valid,name:'../displayed.png',url:outputPrefix+'../displayed.png'},
  ];
  assert.equal(guide.validatedConversationFigures(invalidConversation,caseDefinition).length,0);
  assert.equal(guide.validatedConversationFigures([valid,{...valid}],caseDefinition).length,1);
});

test('case figures win duplicate filenames and conversation-only images remain explicitly unverified',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure()]);
  guide.setConversationFigures([conversationFigure('temperature.png'),conversationFigure('other.png')]);
  assert.equal(gallery.buttons.length,2);
  assert.match(gallery.html,/Conversation figures/);
  assert.doesNotMatch(gallery.html,/April metadata checked/);
  assert.equal(guide.selectFigure(0,true),true);
  assert.match(gallery.html,/Case figures/);
  assert.match(gallery.html,/April metadata checked/);
  assert.equal(guide.selectFigure(0,false),true);
  assert.match(gallery.html,/Conversation figures/);
  assert.match(gallery.html,/case association is unverified/);
  assert.equal(root.figureCount.textContent,'2 figures');
  guide.setCaseFigures([]);
  assert.equal(gallery.buttons.length,2);
  assert.doesNotMatch(gallery.html,/April metadata checked/);
});

test('stream text and unchanged file refreshes preserve gallery DOM and do not steal scroll',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure()]);
  const writes=gallery.writes;
  for(let i=0;i<20;i++)guide.handleEvent('part_delta',{delta:{content_delta:'A figure or role name appears in the response.'}});
  guide.setCaseFigures([caseFigure()]);
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.realize'}});
  assert.equal(gallery.writes,writes);
  assert.equal(gallery.focused,0);
  assert.equal(gallery.scrolled,0);
  root.nodes[0].click();
  guide.setConversationFigures([conversationFigure()]);
  assert.equal(root.figureCount.hidden,false);
  assert.equal(gallery.focused,0);
});

test('explicit Figures opens an empty state, thumbnails select and only Enlarge opens a preview',()=>{
  const {guide,root,gallery}=fixture();const previews=[];
  guide.init({caseDefinition,prompts,showDetails:(title,html)=>previews.push({title,html})});
  guide.showFigures();
  assert.equal(gallery.hidden,false);
  assert.match(gallery.html,/Awaiting saved figures/);
  assert.equal(gallery.focused,1);
  assert.equal(gallery.scrolled,1);
  guide.setCaseFigures([{...caseFigure(),source:'Source <script> is text'}]);
  assert.equal(previews.length,0);
  gallery.buttons[0].click();
  assert.equal(previews.length,0);
  gallery.enlarge.click();
  assert.equal(previews.length,1);
  assert.match(previews[0].html,/Source &lt;script&gt; is text/);
  assert.match(previews[0].html,/Source JSON/);
  guide.init({caseDefinition,prompts});
  guide.setConversationFigures([conversationFigure()]);
  gallery.buttons[0].click();
  gallery.enlarge.click();
  assert.equal(root.expanded.hidden,false);
  assert.match(root.expanded.innerHTML,/case association is unverified/);
});

test('a new conversation clears its images and following state while retaining checked project sources',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setResearchSources([{step:'ledger',name:'ledger.json',url:outputPrefix+'ledger.json'}]);
  guide.setCaseFigures([caseFigure()]);
  guide.setConversationFigures([conversationFigure()]);
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.realize'}});
  root.nodes[2].click();
  guide.resetConversation();
  assert.equal(selectedStep(root),'ledger');
  assert.equal(root.mode.textContent,'Following conversation');
  assert.equal(root.status.textContent,'Waiting for conversation');
  assert.equal(gallery.buttons.length,1);
  assert.match(gallery.html,/April metadata checked/);
  assert.doesNotMatch(gallery.html,/Conversation figures/);
  assert.match(root.sources.innerHTML,/ledger\.json/);
});


test('one focused figure survives refresh and manual review holds when new conversation images arrive',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure(),caseFigure('precipitation','precipitation.png')]);
  assert.equal(guide.selectFigure(1,true),true);
  const writes=gallery.writes;
  guide.setCaseFigures([caseFigure(),caseFigure('precipitation','precipitation.png')]);
  assert.equal(gallery.writes,writes);
  assert.match(gallery.html,/evidence-figure-heading"><h3>precipitation/);
  guide.setConversationFigures([conversationFigure('new.png')]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>precipitation/);
  assert.equal(root.mode.textContent,'Manual review');
  assert.equal(guide.selectFigure(99,true),false);
  root.resume.click();
  guide.setConversationFigures([conversationFigure('new.png'),conversationFigure('latest.png')]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>latest.png/);
  assert.match(gallery.html,/Case not verified/);
  assert.doesNotMatch(gallery.html,/Source JSON/);
  guide.setConversationFigures([]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>temperature/);
  guide.setCaseFigures([]);
  assert.match(gallery.html,/Awaiting saved figures/);
  assert.doesNotMatch(gallery.html,/<img/);
});

test('a newly displayed manifest figure focuses its checked case card without adding a duplicate',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure(),caseFigure('runoff','runoff.png')]);
  const displayed={...conversationFigure('runoff.png'),displayId:'run-1/call-1/2026-11-13T03:00:00.000Z',shownAt:'2026-11-13T03:00:00.000Z'};
  guide.setConversationFigures([displayed]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>runoff/);
  assert.match(gallery.html,/Case figures · April metadata checked/);
  assert.match(gallery.html,/Source JSON/);
  assert.equal(gallery.buttons.length,2);
  assert.equal(root.figureCount.textContent,'2 figures');
  const writes=gallery.writes;
  guide.setCaseFigures([caseFigure(),caseFigure('runoff','runoff.png')]);
  guide.setConversationFigures([{...displayed}]);
  assert.equal(gallery.writes,writes,'an unchanged poll must retain the image DOM');
  assert.equal(gallery.focused,0);
  assert.equal(gallery.scrolled,0);
});

test('redisplaying the same case filename in a later turn follows its new display identity',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure(),caseFigure('runoff','runoff.png')]);
  const first={...conversationFigure('runoff.png'),displayId:'run-1/call-1/2026-11-13T03:00:00.000Z'};
  guide.setConversationFigures([first]);
  guide.selectFigure(0,true);
  assert.match(gallery.html,/evidence-figure-heading"><h3>temperature/);
  guide.beginTurn();
  guide.setConversationFigures([{...first,displayId:'run-2/call-2/2026-11-13T04:00:00.000Z'}]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>runoff/);
  assert.equal(root.mode.textContent,'Following conversation');
});

test('manual inspection holds during new case displays and Resume follows the latest actual figure',()=>{
  const {guide,root,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure(),caseFigure('precipitation','rain.png'),caseFigure('runoff','runoff.png')]);
  guide.selectFigure(1,true);
  guide.setConversationFigures([{...conversationFigure('runoff.png'),displayId:'run-1/call-1/2026-11-13T03:00:00.000Z'}]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>precipitation/);
  assert.equal(root.mode.textContent,'Manual review');
  root.resume.click();
  assert.match(gallery.html,/evidence-figure-heading"><h3>runoff/);
  assert.equal(root.mode.textContent,'Following conversation');
});

test('reopening a conversation selects its latest current display and reset removes that selection',()=>{
  const {guide,gallery}=fixture();
  guide.init({caseDefinition,prompts});
  guide.setCaseFigures([caseFigure(),caseFigure('runoff','runoff.png')]);
  guide.resetConversation();
  guide.setConversationFigures([
    {...conversationFigure('extra.png'),displayId:'run-1/call-1/2026-11-13T03:00:00.000Z'},
    {...conversationFigure('runoff.png'),displayId:'run-1/call-2/2026-11-13T04:00:00.000Z'},
  ]);
  assert.match(gallery.html,/evidence-figure-heading"><h3>runoff/);
  guide.resetConversation();
  assert.match(gallery.html,/evidence-figure-heading"><h3>temperature/);
  assert.equal(gallery.buttons.length,2);
});


test('the interactive workflow stays open for exploration and yields space to actual saved evidence',()=>{
  const {guide,root}=fixture();
  guide.init({caseDefinition,prompts});
  assert.equal(root.overview.open,true);
  guide.setCaseFigures([caseFigure()]);
  assert.equal(root.overview.open,true);
  root.nodes[2].click();
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.realize'}});
  assert.equal(root.overview.open,true);
  root.resume.click();
  assert.equal(root.overview.open,false);
  guide.resetConversation();
  assert.equal(root.overview.open,true);
  guide.handleEvent('function_tool_call',{part:{tool_name:'lab.realize'}});
  assert.equal(root.overview.open,false);
});


test('the case workspace can keep its workflow reference collapsed across conversation resets',()=>{
  const {guide,root}=fixture();
  guide.init({caseDefinition,prompts,overviewOpen:false});
  assert.equal(root.overview.open,false);
  root.overview.open=true;
  guide.resetConversation();
  assert.equal(root.overview.open,false);
  guide.init({caseDefinition,prompts});
  assert.equal(root.overview.open,true);
});
