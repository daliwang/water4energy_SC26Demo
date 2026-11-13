'use strict';
const WORKBENCH_VERSION='0.15.1';

// No external services or frontend dependencies. Live calls stay behind server.py.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  mode: 'live', view: 'development', activeContext:'headwater', contextRevision:0, headwaterEvidenceTopic:'overview', lab24EvidenceTopic:'ledger', projectFigures:[], projectFigureSelection:null, drafts:{}, config: {project: 'Water4Energy-TVA-agent-loop'},
  status: null, geo: null, siteIndex: 0,
  busy: false, sessionId: null, history: [], events: [], lastSeq: 0,
  stream: null, pending: null, liveFiles: [], liveStudy: null,
  demoEvidence: null, connectionRevision: 0, network: null, demoCase: null, knowledge: null, prompts: [], skills: null, focusSiteId: 'ELF13', selectedStage: null, promptCategory: 'All',
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const dateLabel = (value, options = {}) => new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString('en-US', {timeZone:'UTC',month:'short',day:'numeric',...options});
const format = (n, digits=1) => n!==null && n!==undefined && n!=='' && Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
const projectUrl = (path='') => `/api/vista/projects/${encodeURIComponent(state.config.project)}${path}`;
const fileUrl = (kind,name) => projectUrl(`/${kind}/${String(name).split('/').map(encodeURIComponent).join('/')}`);
const legacySessionKey=()=>`tva.session.${state.config.backend_url||''}.${state.config.project}`;
const sessionKey=()=>`water4energy.session.${state.config.backend_url||''}.${state.config.project}.${state.activeContext}`;
const contextMapKey=()=>`water4energy.contexts.${state.config.backend_url||''}.${state.config.project}`;
function sessionContext(id){try{const saved=JSON.parse(localStorage.getItem(contextMapKey())||'{}');return ['headwater','lab24','tva'].includes(saved[id])?saved[id]:(localStorage.getItem(legacySessionKey())===id?'tva':null);}catch{return null;}}
const rememberSession=()=>{try{if(state.sessionId){localStorage.setItem(sessionKey(),state.sessionId);const saved=JSON.parse(localStorage.getItem(contextMapKey())||'{}');saved[state.sessionId]=state.activeContext;localStorage.setItem(contextMapKey(),JSON.stringify(saved));}else localStorage.removeItem(sessionKey());}catch{}};
const readSessionId=()=>{try{return localStorage.getItem(sessionKey())||(state.activeContext==='tva'?localStorage.getItem(legacySessionKey()):null);}catch{return null;}};
function isAprilContext(){return state.activeContext==='tva';}
function isLab24Context(){return state.activeContext==='lab24';}
function updateContextUI(){
  const april=isAprilContext(),lab24=isLab24Context();
  const contexts=window.Water4EnergyWorkflow?.contexts||[{id:'headwater',label:'HEADWATER development'},{id:'lab24',label:'Hypothesis lab · 24 October 2026'},{id:'tva',label:'TVA · 16–22 April 2019'}];
  const switcher=$('#active-context');if(switcher){switcher.innerHTML=contexts.map(c=>`<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('');switcher.value=state.activeContext;switcher.disabled=state.busy;}
  const labels={headwater:'HEADWATER',lab24:'October worked example',tva:'TVA · April 2019'};
  const pills=$('#context-pills');if(pills)pills.innerHTML=contexts.map(c=>`<button type="button" data-project-context="${c.id}" aria-label="${esc(c.label)}" aria-pressed="${c.id===state.activeContext}"${state.busy?' disabled':''}>${labels[c.id]||esc(c.label)}</button>`).join('');
  $('#case-lab-subtitle').textContent=april?'TVA · 16–22 April 2019 · Issued 15 April 2019':lab24?'Completed test · 24 October 2026':'HEADWATER development';
  $('#prompt').placeholder=april?'Ask about the April case, or choose a question…':lab24?'Ask about the completed October test…':'Start from the ledger, or choose a question…';
  $$('[data-april-only]').forEach(el=>el.hidden=!april);
  $('#development-evidence').hidden=april||lab24;
  if($('#lab24-evidence'))$('#lab24-evidence').hidden=!lab24;
  $('#case-question-controls').innerHTML=april?TVACaseJourney.questionMenuHTML():lab24?Water4EnergyLab24.questionMenuHTML():Water4EnergyWorkflow.questionMenuHTML();
  if(lab24)refreshLab24Evidence();else if(!april)refreshHeadwaterEvidence();
  renderDemoStatus();window.TVAComposerResize?.refresh();
}
function selectContext(next,{restore=true}={}){
  if(!['headwater','lab24','tva'].includes(next))return false;
  if(next===state.activeContext)return true;
  if(state.busy){toast('Finish or stop the current turn before changing context.');if($('#active-context'))$('#active-context').value=state.activeContext;return false;}
  state.drafts[state.activeContext]=$('#prompt').value;rememberSession();
  state.stream?.abort();state.stream=null;clearLiveConversation(true);TVAHypothesisDemo.reset();
  state.contextRevision++;state.activeContext=next;state.headwaterEvidenceTopic='overview';state.lab24EvidenceTopic='ledger';state.sessionId=null;state.history=[];state.liveFiles=[];state.liveStudy=null;state.demoEvidence=null;
  resetActivity();updateContextUI();showWelcome();renderResults();$('#prompt').value=state.drafts[next]||'';
  if(restore){state.sessionId=readSessionId();if(state.sessionId&&state.status?.project_found)void loadSession(state.sessionId,true);}
  if(isAprilContext())void refreshDemo();return true;
}
function openTVACase(view='workspace'){if(!selectContext('tva'))return false;switchView(view==='network'?'network':'workspace');return true;}
function prepareProjectPrompt(text){if(selectContext('headwater')){refreshHeadwaterEvidence(text);prepareDemoPrompt(text);}}
function prepareLabPrompt(text){if(selectContext('lab24')){refreshLab24Evidence(text);prepareDemoPrompt(text);}}
function prepareAprilPrompt(text){if(selectContext('tva'))prepareDemoPrompt(text);}

function refreshHeadwaterEvidence(prompt=null) {
  if(state.activeContext!=='headwater')return;
  const workflow=globalThis.Water4EnergyWorkflow;
  if(!workflow?.renderContextEvidence)return;
  const topic=typeof prompt==='string'?(workflow.evidenceTopicForRequest?.(prompt)||'overview'):(state.headwaterEvidenceTopic||'overview');
  state.headwaterEvidenceTopic=topic;
  const container=$('#development-evidence');
  if(container)workflow.renderContextEvidence(container,{topic});
  const stage={ledger:'hypothesis',brief:'design',data:'data',board:'execution',score:'score',downscale:'downscale'}[topic];
  if(typeof prompt==='string'&&stage)workflow.selectStage?.(stage);
  renderProjectFigures();
}

function refreshLab24Evidence(prompt=null){
  if(!isLab24Context())return;
  const lab=globalThis.Water4EnergyLab24;if(!lab?.renderContextEvidence)return;
  const topic=typeof prompt==='string'?(lab.evidenceTopicForRequest?.(prompt)||'ledger'):(state.lab24EvidenceTopic||'ledger');
  state.lab24EvidenceTopic=topic;
  const container=$('#lab24-evidence');if(container)lab.renderContextEvidence(container,{topic});
  if(typeof prompt==='string')lab.selectStep?.(topic);
  renderProjectFigures();
}


async function api(url, options={}) {
  const response = await fetch(url, {...options, headers:{...(options.body && !(options.body instanceof FormData) ? {'Content-Type':'application/json'} : {}), ...options.headers}});
  if (!response.ok) {
    let detail;
    try { const body = await response.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body); }
    catch { detail = response.statusText; }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}
function toast(message) {
  $('#toast').textContent=message; $('#toast').hidden=false;
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').hidden=true,6000);
}
function showDetails(title,html) {
  $('#details-title').textContent=title; $('#details-content').innerHTML=html;
  if (!$('#details-dialog').open) $('#details-dialog').showModal();
}
function download(name, text, type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const a=document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function setBusy(value,label) {
  state.busy=value;
  $('.agent-panel')?.classList.toggle('is-working',value);
  $('#send-button').hidden=value;
  $('#stop-button').hidden=!value;
  $('#send-button').disabled=value;
  $$('[data-case-question],[data-headwater-question],[data-lab24-question],[data-project-context]').forEach(button=>button.disabled=value);
  if($('#active-context'))$('#active-context').disabled=value;
  $('#new-chat').disabled=value; $('#history-new').disabled=value;
  $('#agent-state').textContent=label || (value ? 'Working…' : state.status?.project_found ? 'VISTA agent' : 'Connect VISTA');
  $('#agent-state').classList.toggle('working',value);
  window.TVAComposerResize?.refresh();
  scheduleLivePoll();
}
function setStage(index,complete=false) {
  $$('#workflow-strip [data-step]').forEach((el,i)=>{
    el.classList.toggle('done',i<index || complete);
    el.classList.toggle('active',i===index && !complete);
  });
}
function addActivity(title,detail='',kind='info',raw=null) {
  const item={time:new Date().toLocaleTimeString('en-US',{hour12:false}),title,detail,kind};
  $('.agent-panel')?.classList.add('has-activity');
  state.events.push(item); if(state.events.length>250) state.events.shift();
  const row=document.createElement('div'); row.className='activity-event';
  row.innerHTML=`<time>${esc(item.time)}</time><div><strong>${esc(title)}</strong>${detail?`<div>${esc(detail)}</div>`:''}${raw?`<details><summary>Event detail</summary><pre>${esc(JSON.stringify(raw,null,2).slice(0,12000))}</pre></details>`:''}</div>`;
  $('#activity-log').append(row);
  while($('#activity-log').children.length>250) $('#activity-log').firstChild.remove();
  $('#activity-count').textContent=state.events.length; $('#activity-last').textContent=title;
  $('#activity-log').scrollTop=$('#activity-log').scrollHeight;
}
function resetActivity() {
  $('.agent-panel')?.classList.remove('has-activity');
  state.events=[]; state.lastSeq=0; $('#activity-log').replaceChildren();
  $('#activity-count').textContent='0'; $('#activity-last').textContent='Events and tool calls appear here'; setStage(-1);
}
function formatText(text) {
  // Escape first: model/file text can never inject active HTML into the page.
  let html=esc(text);
  html=html.replace(/```[^\n]*\n([\s\S]*?)```/g,(_,code)=>`<pre>${code}</pre>`);
  html=html.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');
  html=html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return html;
}
function addMessage(role,text,options={}) {
  $('#chat-messages .welcome')?.remove();
  $('.agent-panel')?.classList.add('has-messages');
  const el=document.createElement('div'); el.className=`message ${role}${options.error?' error':''}`;
  const label=role==='agent' ? '<div class="message-label"><b>Water4Energy agent</b><span>VISTA</span></div>' : '';
  const preview=role==='user'?globalThis.Water4EnergyAgentResponse?.requestPreview?.(text):null;
  el.innerHTML=`${label}<div class="message-body">${preview?`${formatText(preview.question)}<details class="request-details"><summary>Request details</summary><div>${formatText(preview.details)}</div></details>`:formatText(text)}</div>`;
  if(options.retryPrompt){
    const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='Prepare question again';
    retry.addEventListener('click',()=>{if(!state.busy)prepareDemoPrompt(options.retryPrompt);});
    el.append(retry);
  }
  $('#chat-messages').append(el); scrollChat(); return el.querySelector('.message-body');
}
function scrollChat() { $('#chat-scroll').scrollTop=$('#chat-scroll').scrollHeight; }
function showWelcome() {
  $('.agent-panel')?.classList.remove('has-messages');
  $('#chat-messages').innerHTML=isAprilContext()?TVACaseJourney.welcomeHTML():isLab24Context()?Water4EnergyLab24.welcomeHTML():Water4EnergyWorkflow.welcomeHTML();
}
function prepareDemoPrompt(text) {
  if(state.busy){toast('Finish or stop the current turn before preparing another request.');return;}
  if(!['development','introduction','workspace'].includes(state.view))switchView('workspace');
  $$('#chat-hints details, #conversation-hints details, #case-question-controls details').forEach(detail=>{detail.open=false;});
  $('#prompt').value=text;$('#prompt').focus({preventScroll:true});
  const composer=$('#chat-form'),bounds=composer.getBoundingClientRect?.();
  if(!bounds || bounds.top<0 || bounds.bottom>window.innerHeight)composer.scrollIntoView({behavior:'smooth',block:'nearest'});
  globalThis.TVAComposerResize?.refresh();
  toast('Request prepared. Review it, then press Send.');
}
async function refreshKnowledge() {
  const project=state.config.project,backend=state.config.backend_url;
  try {
    const knowledge=await api('/api/knowledge?fresh=1');
    if(project!==state.config.project || backend!==state.config.backend_url || knowledge.project!==project)return;
    state.knowledge=knowledge;
  }catch(error){state.knowledge={project,count:null,ready_count:null,all_ready:null,knowledge_bases:[],detail:error.message};}
}
function renderDemoStatus() {
  const line=$('#demo-status-line');if(!line)return;
  const status=state.status;
  line.dataset.state='pending';
  if(!status){line.textContent='Checking the VISTA connection…';line.dataset.state='checking';}
  else if(state.demoCase && status.version!==WORKBENCH_VERSION){line.textContent='An older Workbench is serving this tab. Open the current launcher and use its printed address.';}
  else if(!status.connected){line.textContent='Open VISTA to send questions. You can review the starting questions while it connects.';}
  else if(!status.project_found){line.textContent='VISTA is open; the project still needs setup before you can send questions.';}
  else {
    const required=state.skills?.skills || [];
    const known=state.skills?.project_found && Number.isInteger(state.skills.count);
    const names=new Set(required.map(skill=>skill.name));
    const missing=known && (state.demoCase?.requiredSkills || []).some(skill=>!names.has(skill.id)&&!names.has(skill.id.replace(/[._]/g,'-')));
    const knowledgePending=state.knowledge?.project_found && state.knowledge.all_ready===false;
    line.textContent=missing || knowledgePending?'Connected to VISTA. Some project tools or sources still need setup.':isAprilContext()?'Connected to the April case project.':'Connected to the Water4Energy project.';
    line.dataset.state='connected';
  }
  const badge=$('#case-figures-status');
  if(badge)badge.textContent=state.demoEvidence?.matched?`${state.demoEvidence.available} of 4 figures`:'Awaiting source files';
}
async function refreshDemo(){
  if(!state.demoCase||!window.TVAHypothesisDemo)return;
  TVAHypothesisDemo.updateCapabilities?.({status:state.status,skills:state.skills,knowledge:state.knowledge,project:state.config.project,backend:state.config.backend_url});
  if(!isAprilContext()){renderDemoStatus();return;}
  const revision=state.contextRevision;
  const result=await TVAHypothesisDemo.refresh({status:state.status,skills:state.skills,knowledge:state.knowledge,project:state.config.project,backend:state.config.backend_url});
  if(!isAprilContext()||revision!==state.contextRevision)return;
  if(result){state.demoEvidence=result;TVAHypothesisGuide.setResearchSources(result.researchLinks||[]);TVAHypothesisGuide.setCaseFigures(result.caseFigures||[]);}renderDemoStatus();
}

function openCaseFigures() {
  switchView('workspace');
  if(isAprilContext())TVAHypothesisGuide.showFigures();
  else renderProjectFigures();
}

function dockConversation(view){
  const dock=$('#conversation-dock'),panel=$('.agent-panel'),home=$('#view-workspace .hypothesis-lab-grid');
  if(!dock||!panel||!home)return;
  const beside=['development','introduction'].includes(view);
  document.body.classList.toggle('chat-beside',beside);
  if(beside){dock.append(panel);dock.hidden=false;}
  else{home.prepend(panel);dock.hidden=true;}
  const title=panel.querySelector('.lab-chat-title h1');if(title)title.textContent=beside?'Conversation':'Case Lab';
  renderProjectFigures();
}

function switchView(view) {
  if(view==='development'&&!selectContext('headwater'))return;
  if(view==='introduction'&&!selectContext('lab24'))return;
  if(view==='network'&&!selectContext('tva'))return;
  state.view=view;
  document.body.classList.toggle('lab-active',view==='workspace');
  dockConversation(view);
  $$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===(view==='history'?'workspace':view)));
  $('#view-breadcrumb').textContent={development:'HEADWATER development',workspace:'Case Lab',network:'TVA case',skills:'Skills & sources',introduction:'Hypothesis lab',history:'Conversation history',files:'Results Library',literature:'Literature library',compute:'Compute'}[view];
  if(view==='history'){renderPromptLibrary();renderHistory();} if(view==='files') renderFiles(); if(view==='literature') window.TVALiteratureLibrary?.render();
  if(view==='network')renderNetwork();if(view==='skills')renderSkills();if(view==='compute')renderCompute();
  window.scrollTo({top:0,behavior:'instant'});
  const activeView=$(`#view-${view}`);if(activeView)activeView.scrollTop=0;
  window.TVACaseJourney?.setView(view);
  if(view==='workspace')window.TVAComposerResize?.refresh();
}

async function refreshConnection() {
  const revision=++state.connectionRevision;
  $('#connection-pill').innerHTML='<i></i> Checking VISTA';
  try {
    const status=await api('/api/status?fresh=1');
    if(revision!==state.connectionRevision)return;
    state.status=status;state.config={backend_url:status.backend_url,project:status.project};
    const compatible=state.status.version===WORKBENCH_VERSION;
    const ok=compatible && state.status.connected && state.status.project_found;
    $('#connection-pill').classList.toggle('connected',ok);
    $('#connection-pill').innerHTML=`<i></i>${!compatible?'Open the current launcher':ok?'VISTA connected':state.status.connected?'Check project name':'VISTA offline'}`;
    $('#connection-pill').title=compatible?state.status.detail:`This tab is served by Workbench ${state.status.version || 'unknown'}. Open the v${WORKBENCH_VERSION} launcher and use its printed local address.`;
    if(!ok){clearLiveConversation(true);state.liveFiles=[];renderResults();}
    renderResources();await refreshSkills();await refreshKnowledge();await renderFiles();await refreshDemo();setBusy(state.busy);if(ok && state.sessionId)queueLiveArtifacts();
    if($('#settings-dialog').open) $('#settings-status').textContent=state.status.detail;
  } catch(error) {if(revision!==state.connectionRevision)return;state.status=null;state.skills=null;state.knowledge=null;state.demoEvidence=null;clearLiveConversation(true);TVAHypothesisDemo.reset();await refreshDemo();$('#connection-pill').classList.remove('connected');$('#connection-pill').innerHTML='<i></i> Connection unavailable';}
}
function resourceState(resource) {
  if(resource.planned) return ['planned','Planned'];
  if(resource.state==='ready') return ['ready','Ready in VISTA'];
  if(['not_connected','not_configured','missing','unconfigured'].includes(resource.state)) return ['error','Not connected'];
  if(['degraded','error','unavailable','expired','globus_session_expired','login_required'].includes(resource.state)) return ['error','Needs attention'];
  if(resource.state==='checking') return ['','Checking'];
  return ['',state.status?.connected?'Status unavailable':'VISTA offline'];
}
function renderResources() {
  const resources=state.status?.resources || ['odo','frontier','lux','ccsi'].map((id,i)=>({id,name:['Odo','Frontier','Lux','CCSI GPU node'][i],state:'unknown',planned:id==='ccsi',message:id==='ccsi'?'Planned resource. Connection and a matching VISTA adapter will be added later.':'Open VISTA to check resource status.'}));
  if($('#sidebar-resources'))$('#sidebar-resources').innerHTML=resources.map(r=>{const [cls,label]=resourceState(r);return `<div class="resource-mini ${r.id==='ccsi'?'ccsi':''}" title="${esc(r.message)}"><span class="resource-glyph">${icon('server')}</span><div><strong>${esc(r.name)}</strong><small>${esc(label)}</small></div><i class="status-dot ${cls}"></i></div>`;}).join('');
  window.Water4EnergyWorkflow?.setResources(resources);
  if($('#resource-cards'))$('#resource-cards').innerHTML=resources.map(r=>{const [cls,label]=resourceState(r);return `<article class="resource-card ${r.planned?'planned':''}"><div class="resource-card-header">${icon('server')}<span class="tag"><i class="status-dot ${cls}"></i>${esc(label)}</span></div><h2>${esc(r.name)}</h2><div class="facility">${r.planned?'FUTURE ADAPTER':'COMPUTE CONNECTION IN VISTA'}</div><p>${esc(r.message)}</p><div class="tag">${r.planned?'Adapter to be added':'Optional compute · file-based demo first'}</div></article>`;}).join('');
  if($('#compute-resource-cards')&&$('#resource-cards'))$('#compute-resource-cards').innerHTML=$('#resource-cards').innerHTML;
}
function renderCompute(){renderResources();}
function showSettings() {
  $('#backend-url').value=state.config.backend_url || 'http://127.0.0.1:8001';
  $('#project-name').value=state.config.project;
  $('#settings-status').textContent=state.status?.detail || 'Open VISTA, then save and check this connection.';
  renderResources();$('#settings-dialog').showModal();
}

function renderMap() {
  drawNetworkMap('basin-map');
  if(state.view==='network')drawNetworkMap('network-map',1000,410);
}
function currentStudy() { return state.liveStudy; }
function renderResults() {
  $('#results-panel').classList.remove('has-live-study');
  $('#results-panel').classList.toggle('has-live-artifacts',!!state.liveFiles.length);
  $('#results-description').textContent=isAprilContext()?'Files displayed in this TVA case conversation. April source checks are separate.':'Files displayed in the selected project conversation.';
  $('#result-mode-label').textContent=state.liveFiles.length?`${state.liveFiles.length} displayed file${state.liveFiles.length===1?'':'s'}`:'Conversation files';
  $('#chart-site-tabs').innerHTML='';$('#result-site').innerHTML='';
  $('#result-site').closest('.chart-site-picker').hidden=true;
  $('.chart-legend').hidden=true;$('#chart-axis-label').hidden=true;
  $('#result-stats').innerHTML='';
  $('.live-artifacts')?.remove();
  $('#result-chart').innerHTML=state.liveFiles.length?'':'<div class="live-result-empty">Displayed files will appear here after an agent turn. Saved project outputs are available in the Results Library.</div>';
  $('.chart-layout').hidden=!!state.liveFiles.length;
  $('#provenance-short').textContent=state.liveFiles.length?'Conversation file metadata; case association is checked separately.':'Waiting for displayed files.';
  renderLiveArtifacts();
}
function showProvenance() {
  const files=state.liveFiles.map(file=>({name:file.path||file.name,kind:file.kind||'outputs',status:file.status||'current'}));
  showDetails('Conversation file details',`<p>These are files explicitly displayed in the selected conversation. The fixed-case panels use their own manifest and source checks.</p><pre>${esc(JSON.stringify(files,null,2))}</pre>`);
}

async function ensureSession(title) {
  if(state.sessionId) return state.sessionId;
  const session=await api(projectUrl('/chat-sessions'),{method:'POST',body:JSON.stringify({title:title.slice(0,80)})});
  state.sessionId=session.id;state.lastSeq=0;rememberSession();return session.id;
}
async function sendLive(prompt) {
  if(state.demoCase && state.status?.version && state.status.version!==WORKBENCH_VERSION){addMessage('system',`This tab is served by Workbench ${state.status.version}. Open the v${WORKBENCH_VERSION} launcher and use its printed local address before starting this conversation.`,{error:true});return;}
  if(!state.status?.project_found){addMessage('system','Open VISTA and connect the project in Connection settings before sending a live message.',{error:true});showSettings();return;}
  if(state.busy)return;
  state.projectFigureSelection=null;
  if(isAprilContext())TVAHypothesisGuide.beginTurn();else if(isLab24Context())refreshLab24Evidence(prompt);else refreshHeadwaterEvidence(prompt);
  addMessage('user',prompt);setBusy(true,'Contacting VISTA');setStage(0);state.lastSeq=0;
  const sendRevision=state.contextRevision;
  try {
    await ensureSession(prompt);
    await watchStream(projectUrl('/agent/run'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_prompt:prompt,stream:true,chat_session_id:state.sessionId})});
  } catch(error) {
    if(sendRevision!==state.contextRevision)return;
    addMessage('system',`${error.message} If VISTA accepted the turn, it may still be running. Reopen this conversation to check or reconnect.`,{error:true});
    addActivity('Connection interrupted',error.message);setBusy(false,'Connection interrupted');if(isAprilContext())TVAHypothesisGuide.finishTurn('interrupted');
  }
}
async function watchStream(url,options={}) {
  const streamContext=liveContext();
  const controller=new AbortController();state.stream=controller;let finished=false,bodyNode=null,parts=new Map(),lastIndex=null,actualToolCalls=0;
  const response=await fetch(url,{...options,signal:controller.signal});
  if(response.status===204){if(!isLiveContext(streamContext))return;state.stream=null;setBusy(false,'Turn ended');await loadSession(state.sessionId,false);await renderFiles();return;}
  if(!response.ok){let data;try{data=await response.json();}catch{};throw new Error(typeof data?.detail==='string'?data.detail:`VISTA request failed (${response.status}).`);}
  if(!response.body)throw new Error('This browser does not support streaming responses.');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  const outputText=()=>{
    if(!bodyNode)bodyNode=addMessage('agent','');
    const text=[...parts.values()].join('\n\n');
    bodyNode.innerHTML=formatText(globalThis.Water4EnergyAgentResponse?.isMalformedToolResponse(text,actualToolCalls)?'Checking the agent response…':text);bodyNode.classList.add('stream-cursor');scrollChat();
  };
  async function eventReceived(block) {
    let type='message',data=[],seq;
    for(const line of block.split('\n')){
      if(line.startsWith('event:'))type=line.slice(6).trim();
      if(line.startsWith('data:'))data.push(line.slice(5).trimStart());
      if(line.startsWith('id:'))seq=Number(line.slice(3).trim());
    }
    if(seq && seq<=state.lastSeq)return;
    if(seq)state.lastSeq=seq;
    if(!data.length)return;
    let event;try{event=JSON.parse(data.join('\n'));}catch{return;}
    type=event.event_kind || type;
    if(!isLiveContext(streamContext))return;
    if(isAprilContext())TVAHypothesisGuide.handleEvent(type,event);
    if(['function_tool_result','run_finished'].includes(type))queueLiveArtifacts();
    if(type==='run_started'){addActivity('VISTA turn started','Backend-owned execution; conversation saved by VISTA.');setBusy(true,'Agent working');setStage(0);}
    else if(type==='part_start' && event.part?.part_kind==='text') {lastIndex=event.index;parts.set(event.index,event.part.content || '');outputText();}
    else if(type==='part_delta' && event.delta?.part_delta_kind==='text') {const index=event.index ?? lastIndex;parts.set(index,(parts.get(index)||'')+(event.delta.content_delta||''));outputText();}
    else if(type==='part_end' && event.part?.part_kind==='text') {parts.set(event.index,event.part.content||parts.get(event.index)||'');outputText();}
    else if(type==='function_tool_call') {
      actualToolCalls++;
      const tool=event.part?.tool_name || event.tool_name || 'Scientific tool';
      addActivity(`Tool call · ${tool}`,'Actual VISTA tool event.','tool',event.part);
      queueLiveArtifacts();
      setStage(1);
      if(/outputs|display|plot/i.test(tool))setStage(2);
    }
    else if(type==='function_tool_result') {const tool=event.part?.tool_name || 'Scientific tool';addActivity(`Tool returned · ${tool}`,'Inspect tool output for execution status.','tool',event.part);}
    else if(type==='log') addActivity(`${event.area || 'VISTA'} · ${event.level || 'INFO'}`,String(event.message || '').slice(0,2500));
    else if(['mcp_form_elicitation','mcp_url_elicitation','mcp_tool_approval'].includes(type)) {addActivity('Your input is needed',event.message || 'VISTA is waiting.');showElicitation(event);}
    else if(type==='prompt_resolved') {if(state.pending?.elicitation_id===event.elicitation_id){state.pending=null;$('#elicitation-dialog').close();}}
    else if(type==='agent_run_result') {
      const result=event.result || event;
      state.history=result.new_messages || state.history;
    }
    else if(type==='run_finished') {
      finished=true;bodyNode?.classList.remove('stream-cursor');
      const malformed=globalThis.Water4EnergyAgentResponse?.isMalformedToolResponse([...parts.values()].join('\n\n'),actualToolCalls);
      const ok=event.state==='done' && !malformed;
      addActivity(malformed?'Answer unavailable':ok?'Agent turn completed':`Agent turn ${event.state}`,malformed?Water4EnergyAgentResponse.MALFORMED_TOOL_MESSAGE:event.error ? String(event.error) : 'A completed agent turn does not by itself verify an HPC job.');
      if(malformed && bodyNode)bodyNode.textContent=Water4EnergyAgentResponse.MALFORMED_TOOL_MESSAGE;
      setBusy(false,malformed?'Answer unavailable':ok?'Turn completed':`Turn ${event.state}`);
      $$('#workflow-strip .active').forEach(el=>el.classList.remove('active'));
      if(event.error)addMessage('system',String(event.error),{error:true});
      state.pending=null;$('#elicitation-dialog').close();
    }
  }
  try {
    while(true) {
      const {value,done}=await reader.read();
      buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      buffer=buffer.replace(/\r\n/g,'\n');
      let split;
      while((split=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);await eventReceived(block);}
      if(done)break;
    }
    if(buffer.trim())await eventReceived(buffer);
    if(!finished)throw new Error('The event stream ended before VISTA reported completion.');
    if(!isLiveContext(streamContext))return;
    await loadSession(state.sessionId,false);
    if(isLiveContext(streamContext))await renderFiles();
  } finally {bodyNode?.classList.remove('stream-cursor');if(state.stream===controller)state.stream=null;}
}
function messagesFromHistory(session) {
  const history=Array.isArray(session.message_history)?session.message_history:[];
  state.history=history;
  const transcript=[];let turn=[],actualToolCalls=0,prompt='';
  const flushTurn=()=>{
    for(const message of turn){
      if(message.role==='agent' && globalThis.Water4EnergyAgentResponse?.isMalformedToolResponse(message.text,actualToolCalls))transcript.push({role:'system',text:Water4EnergyAgentResponse.MALFORMED_TOOL_MESSAGE,error:true,retryPrompt:prompt});
      else transcript.push(message);
    }
    turn=[];actualToolCalls=0;
  };
  for(const message of history){
    for(const part of message.parts || []) {
      if(part.part_kind==='user-prompt'){
        const content=typeof part.content==='string'?part.content:(part.content||[]).filter(x=>typeof x==='string').join('\n');
        if(content){flushTurn();prompt=content;turn.push({role:'user',text:content});}
      } else if(part.part_kind==='tool-call')actualToolCalls++;
      else if(part.part_kind==='text' && part.content)turn.push({role:'agent',text:part.content});
    }
  }
  flushTurn();
  if(!transcript.length && Array.isArray(session.messages))for(const m of session.messages)if(m.role==='user'||m.role==='assistant')transcript.push({role:m.role==='user'?'user':'agent',text:m.content || m.text || ''});
  return transcript;
}
async function loadSession(id,reconnect=false) {
  const scope=liveContext();
  try {
    const session=await api(projectUrl(`/chat-session?chat_session_id=${encodeURIComponent(id)}`));
    if(state.sessionId!==id || !isLiveContext(scope))return;
    state.sessionId=id;rememberSession();
    const messages=messagesFromHistory(session);
    const unreadable=[...messages].reverse().find(message=>message.role==='agent'||message.error)?.error===true;
    const latestPrompt=[...messages].reverse().find(message=>message.role==='user')?.text||'';
    if(state.activeContext==='lab24' && typeof refreshLab24Evidence==='function')refreshLab24Evidence(latestPrompt);
    else if(!isAprilContext() && typeof refreshHeadwaterEvidence==='function')refreshHeadwaterEvidence(latestPrompt);
    if(messages.length){$('#chat-messages').replaceChildren();messages.forEach(m=>addMessage(m.role,m.text,m));}
    else showWelcome();
    if(reconnect){resetActivity();if(isAprilContext())TVAHypothesisGuide.resetConversation();for(const entry of session.run_events || []){
      const data=entry.data || {};
      if(isAprilContext())TVAHypothesisGuide.handleEvent(data.event_kind || entry.event,data);
      if(entry.event==='log')addActivity(data.area || 'VISTA',data.message || '');
      else if(entry.event==='function_tool_call'||entry.event==='function_tool_result')addActivity(`${entry.event==='function_tool_call'?'Tool call':'Tool returned'} · ${data.part?.tool_name || 'Scientific tool'}`,'Saved VISTA activity.','tool',data.part);
      else if(entry.event==='run_finished')addActivity(unreadable?'Answer unavailable':`Agent turn ${data.state || 'ended'}`,unreadable?Water4EnergyAgentResponse.MALFORMED_TOOL_MESSAGE:'Saved VISTA turn state; inspect outputs for job evidence.');
    }}
    await loadLiveArtifacts();
    if(state.sessionId!==id || !isLiveContext(scope))return;
    if(unreadable && !['working','needs_you'].includes(session.run_status))setBusy(false,'Answer unavailable');
    if(reconnect && ['working','needs_you'].includes(session.run_status)) {
      setBusy(true,'Reconnecting');state.lastSeq=0;
      watchStream(projectUrl(`/chat-sessions/${id}/run/events?after=0`)).catch(error=>{if(!isLiveContext(scope))return;addMessage('system',error.message,{error:true});setBusy(false,'Disconnected');if(isAprilContext())TVAHypothesisGuide.finishTurn('disconnected');});
    }
  } catch(error){if(state.sessionId!==id || !isLiveContext(scope))return;clearLiveConversation();state.sessionId=null;rememberSession();addMessage('system',`Could not open that VISTA conversation: ${error.message}`,{error:true});}
}
async function newConversation() {
  if(state.busy)return;
  clearLiveConversation();state.sessionId=null;rememberSession();state.history=[];state.liveFiles=[];state.liveStudy=null;
  resetActivity();if(isLab24Context()){state.lab24EvidenceTopic='ledger';refreshLab24Evidence();}else if(!isAprilContext()){state.headwaterEvidenceTopic='overview';refreshHeadwaterEvidence();}showWelcome();renderResults();if(!['development','introduction'].includes(state.view))switchView('workspace');toast('A new conversation will be created when you send your first message.');
}
async function renderHistory(){
  $('#history-list').innerHTML='<div id="live-history"><div class="empty-state">Loading project conversations…</div></div>';
  if(!state.status?.project_found){$('#live-history').innerHTML='<div class="empty-state">Connect VISTA to view this laptop’s project conversations.</div>';return;}
  try{
    const sessions=await api(projectUrl('/chat-sessions'));
    const button=(session,context,label)=>`<button type="button" class="text-button" data-session="${esc(session.id)}" data-session-context="${context}">${label}</button>`;
    $('#live-history').innerHTML=sessions.length?sessions.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map(session=>{const context=sessionContext(session.id);return `<article class="history-card"><div><h3>${esc(session.title||'Project conversation')}</h3><p>${esc(new Date(session.updated_at).toLocaleString())}</p><div class="history-context-actions">${context?button(session,context,context==='tva'?'Open TVA case conversation ↗':context==='lab24'?'Open October experiment conversation ↗':'Open HEADWATER conversation ↗'):`<span>Choose context to open:</span>${button(session,'headwater','HEADWATER development')}${button(session,'lab24','Hypothesis lab · 24 Oct 2026')}${button(session,'tva','TVA · 16–22 April 2019')}`}</div></div></article>`;}).join(''):'<div class="empty-state">No project conversations yet. Send a message to begin.</div>';
    $$('#live-history [data-session]').forEach(el=>el.addEventListener('click',async()=>{if(state.busy){toast('Finish the current turn first.');return;}if(!selectContext(el.dataset.sessionContext,{restore:false}))return;clearLiveConversation();state.liveFiles=[];state.liveStudy=null;state.history=[];resetActivity();state.sessionId=el.dataset.session;state.lastSeq=0;rememberSession();const scope=liveContext();await loadSession(state.sessionId,true);if(isLiveContext(scope))switchView('workspace');}));
  }catch(error){$('#live-history').innerHTML=`<div class="empty-state">${esc(error.message)}</div>`;}
}

function fileRow(name,detail,url,label='Download') {return `<div class="file-row">${icon('file')}<div><strong>${esc(name)}</strong><small>${esc(detail)}</small></div><a href="${esc(url)}" download>${label}${icon('down')}</a></div>`;}
async function renderFiles() {
  return TVAResultsLibrary.render({projectFound:state.status?.project_found,project:state.config.project,api,projectUrl,fileUrl,showDetails,toast});
}
async function uploadFiles(files) {
  if(!files.length)return;
  if(!state.status?.project_found){toast('Connect your local TVA project before uploading files.');return;}
  const form=new FormData();for(const f of files)form.append('files',f);
  try {
    const result=await api(projectUrl('/uploads'),{method:'POST',body:form});
    toast(`${files.length} file${files.length===1?'':'s'} uploaded to ${state.config.project}.`);
    addActivity('Input files uploaded',Array.isArray(result)?result.join(', '):Array.from(files).map(f=>f.name).join(', '));
    if(state.view==='files')renderFiles();
  }catch(error){toast(`Upload failed: ${error.message}`);}
}
let liveRefresher=null,livePollTimer=null;
function liveContext(){return {project:state.config.project,backend:state.config.backend_url,session:state.sessionId,activeContext:state.activeContext,contextRevision:state.contextRevision};}
function isLiveContext(scope){return scope.project===state.config.project && scope.backend===state.config.backend_url && scope.session===state.sessionId && scope.activeContext===state.activeContext && scope.contextRevision===state.contextRevision;}
function clearLiveConversation(clearCase=false){
  state.projectFigures=[];state.projectFigureSelection=null;renderProjectFigures();
  liveRefresher?.invalidate();
  if(livePollTimer){clearTimeout(livePollTimer);livePollTimer=null;}
  window.TVAHypothesisGuide?.resetConversation();
  if(clearCase){window.TVAHypothesisGuide?.setResearchSources([]);window.TVAHypothesisGuide?.setCaseFigures([]);}
}
function artifactRefresher(){
  if(!liveRefresher)liveRefresher=TVALiveLabSync.createRefresher({
    isCurrent:isLiveContext,
    read:async scope=>{
      const base='/api/vista/projects/'+encodeURIComponent(scope.project);
      const [files,outputs]=await Promise.all([api(base+'/chat-sessions/'+encodeURIComponent(scope.session)+'/displayed-files'),api(base+'/outputs')]);
      if(isLiveContext(scope)&&isAprilContext())await refreshDemo();
      return {files:Array.isArray(files)?files:[],outputs:Array.isArray(outputs)?outputs:[]};
    },
    apply:(result,scope)=>{
      state.liveFiles=result.files;state.liveStudy=null;renderResults();
      const figures=TVALiveLabSync.displayedFigures(result.files,result.outputs,scope.project);
      if(isAprilContext())TVAHypothesisGuide.setConversationFigures(figures);
      else{state.projectFigures=figures;renderProjectFigures();}
    },
    onError:()=>{state.liveFiles=[];state.liveStudy=null;renderResults();if(isAprilContext())TVAHypothesisGuide.setConversationFigures([]);else{state.projectFigures=[];renderProjectFigures();}}
  });
  return liveRefresher;
}
function queueLiveArtifacts(){
  if(!state.sessionId || !state.status?.project_found)return;
  void artifactRefresher().request(liveContext());
}
async function loadLiveArtifacts(){
  if(!state.sessionId){state.liveFiles=[];state.liveStudy=null;renderResults();TVAHypothesisGuide.setConversationFigures([]);await refreshDemo();return;}
  await artifactRefresher().request(liveContext());
}
function scheduleLivePoll(){
  if(livePollTimer)clearTimeout(livePollTimer);
  if(!state.busy || !state.sessionId)return;
  livePollTimer=setTimeout(async()=>{
    livePollTimer=null;
    if(state.busy && state.sessionId)await loadLiveArtifacts();
    scheduleLivePoll();
  },4000);
}
// Explicit-unit CSV parsing remains available to artifact clients. Fixed-case panels
// use the case manifest renderer rather than interpreting arbitrary CSVs as this demo.

function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===',' && !quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r') && !quoted){if(c==='\r' && text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}
  const headers=(rows.shift()||[]).map(h=>h.trim().replace(/^\uFEFF/,''));
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i] ?? ''])));
}
function parsePredictionCSV(text,name,kind='outputs') {
  if(!['uploads','outputs'].includes(kind))return null;
  const rows=parseCSV(text);if(!rows.length)return null;
  const idKey=['basin_id','site_id'].find(k=>k in rows[0]);const dateKey=['start','week_start','date'].find(k=>k in rows[0]);
  if(!idKey||!dateKey||!('predicted_volume_m3' in rows[0]))return null;
  const grouped=new Map();
  for(const row of rows){
    const day=row[dateKey].slice(0,10),stamp=Date.parse(day+'T12:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==day)continue;
    if(row.days!=null && row.days!=='' && Number(row.days)!==7)continue;
    const id=row[idKey];if(!grouped.has(id))grouped.set(id,[]);
    const num=v=>v==null||v.trim()===''||!Number.isFinite(Number(v))?null:Number(v)/1e6;
    grouped.get(id).push({date:day,end:row.end || row.week_end || null,predicted:num(row.predicted_volume_m3),observed:num(row.observed_volume_m3)});
  }
  const sites=[...grouped].map(([id,series])=>({id,name:state.network?.sites?.find(s=>s.id===id || s.modelSiteId===id)?.name || id,series:series.sort((a,b)=>a.date.localeCompare(b.date))}));
  if(!sites.length)return null;
  return {sites,units:'million m³',valueLabel:'Weekly predicted volume',source:'Prediction CSV explicitly displayed by the agent in this VISTA conversation.',provenance:{sourceFile:name,sourceFileKind:kind,sourceColumns:['predicted_volume_m3','observed_volume_m3 (when present)'],displayConversion:'m³ divided by 1,000,000'},caveats:['The chart reads the displayed file; it does not independently verify a cluster job or model provenance.','Missing predictions stay missing. Values reflect only the displayed file.'],downloads:[{label:'Original prediction CSV',url:fileUrl(kind,name)}]};
}
function renderLiveArtifacts() {
  if(!state.liveFiles.length)return;
  const container=document.createElement('div');container.className='live-artifacts';
  container.innerHTML=state.liveFiles.map(f=>{
    const path=f.path||f.name;return fileRow(path,`Displayed by this conversation · ${f.kind || 'outputs'}${f.status && f.status!=='current'?' · '+f.status+' since display':''}`,fileUrl(f.kind||'outputs',path));
  }).join('');
  const images=state.liveFiles.filter(f=>(!f.status || f.status==='current') && /\.(png|jpg|jpeg|webp|gif)$/i.test(f.path || f.name)).slice(0,4);
  for(const file of images){
    const path=file.path || file.name,preview=document.createElement('div');preview.className='live-artifact-preview';
    const img=document.createElement('img');img.src=fileUrl(file.kind || 'outputs',path)+'?preview=true';img.alt=`VISTA result: ${path}`;img.loading='lazy';preview.append(img);container.append(preview);
  }
  $('#results-panel').insertBefore(container,$('.result-footer'));
}

let projectFigureMount=null;
const SUPPLIED_PROJECT_FIGURES=new Set(['w4e-v0150-tva-t2m-2019-reslim.png','w4e-v0150-tva-precip-2019-reslim.png','w4e-v0150-valley-temperature-2019.png','w4e-v0150-april-2019-tmax-refine.png','w4e-v0150-april-2019-prcp-refine.png']);
function projectFigureCaption(name){
  if(['w4e-v0150-tva-t2m-2019-reslim.png','w4e-v0150-tva-precip-2019-reslim.png'].includes(name))return 'Earlier model comparison · four saved 2019 weeks. These maps compare earlier models; the residual-test result is reported separately.';
  if(name==='w4e-v0150-valley-temperature-2019.png')return 'Earlier CNN neighborhood comparison · 1×1, 3×3 and 9×9. These maps compare earlier models; the residual-test result is reported separately.';
  if(name==='w4e-v0150-april-2019-tmax-refine.png')return 'Whole April 2019 · 30 days · daily maximum temperature (°C) · monthly mean and daily 95th percentile · about 4 km. This is separate from the 16–22 April weekly Trial 0 comparison and does not establish a coupled forecast pipeline.';
  if(name==='w4e-v0150-april-2019-prcp-refine.png')return 'Whole April 2019 · 30 days · daily precipitation (mm/day) · monthly mean and daily 95th percentile · about 4 km. These are not weekly totals. This is separate from the 16–22 April weekly Trial 0 comparison and does not establish a coupled forecast pipeline.';
  return 'Displayed conversation file. This interface has not verified its scientific source or scope; read its provenance before interpreting it.';
}
function renderProjectFigures(){
  const mount=projectFigureMount||$('#project-live-evidence');if(!mount)return;
  projectFigureMount=mount;
  const figures=(state.projectFigures||[]).filter(file=>TVALiveLabSync.safePath(file?.name)&&/\.(?:png|jpe?g|gif|webp)$/i.test(file.name)&&(!file.status||file.status==='current')&&(!file.kind||file.kind==='outputs')&&file.url===fileUrl('outputs',file.name)+'?preview=true'&&file.downloadUrl===fileUrl('outputs',file.name));
  if(isAprilContext()||!figures.length){mount.hidden=true;mount.replaceChildren();delete mount.dataset.figureKey;return;}
  const selected=figures.find(file=>file.name===state.projectFigureSelection)||figures.at(-1);
  const scope=liveContext();
  const key=JSON.stringify([scope.project,scope.backend,scope.session,scope.activeContext,scope.contextRevision,selected.name,selected.displayId||selected.shownAt||'',state.projectFigureSelection,figures.map(file=>file.name)]);
  const updated=mount.dataset.figureKey!==key;
  if(updated){
    mount.innerHTML=`<h2>Conversation figure</h2><p>${state.projectFigureSelection?'Reviewing your selection':'Following the latest actual display'} · Saved file displayed by VISTA</p><figure><a href="${esc(selected.downloadUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(selected.url)}" alt="Displayed result: ${esc(selected.name)}"></a><figcaption>${esc(projectFigureCaption(selected.name))}<br><span>${esc(selected.name)}</span></figcaption></figure><div class="project-figure-actions"><a href="${esc(selected.downloadUrl)}" download>Download figure ↧</a>${SUPPLIED_PROJECT_FIGURES.has(selected.name)?'<a href="/assets/dali-figures-provenance.json" target="_blank" rel="noopener noreferrer">Supplied figure provenance ↗</a>':''}${state.projectFigureSelection?'<button type="button" class="text-button" data-project-figure-resume>Resume following</button>':''}</div><div class="project-figure-strip" role="group" aria-label="Displayed conversation figures">${figures.map((file,i)=>`<button type="button" data-project-figure="${i}" aria-pressed="${file.name===selected.name}">${esc(file.name)}</button>`).join('')}</div>`;
    mount.dataset.figureKey=key;
    mount.querySelectorAll('[data-project-figure]').forEach(button=>button.addEventListener('click',()=>{state.projectFigureSelection=figures[Number(button.dataset.projectFigure)]?.name||null;renderProjectFigures();}));
    mount.querySelector('[data-project-figure-resume]')?.addEventListener('click',()=>{state.projectFigureSelection=null;renderProjectFigures();});
  }
  mount.hidden=false;
  const host=state.view==='development'?$('#view-development'):state.view==='introduction'?$('#view-introduction'):isLab24Context()?$('#lab24-evidence'):$('#development-evidence');
  if(host&&mount.parentElement!==host)host.prepend(mount);
  if(updated&&state.busy&&!state.projectFigureSelection&&['development','introduction'].includes(state.view))host?.scrollTo?.({top:0,behavior:'smooth'});
}
function showElicitation(event) {
  // Sensitive form values are sent directly to VISTA and never stored or exported.
  state.pending=event;$('#agent-state').textContent='Waiting for your input';
  $('#elicitation-message').textContent=event.message || 'Review this request from VISTA.';
  $('#elicitation-fields').replaceChildren();
  if(event.event_kind==='mcp_url_elicitation'){
    let url;try{url=new URL(event.url);}catch{addMessage('system','VISTA supplied an invalid authorization URL. Complete this step in VISTA.',{error:true});return;}
    if(!['http:','https:'].includes(url.protocol)){addMessage('system','VISTA supplied an unsupported sign-in URL. Complete this step in VISTA.',{error:true});return;}
    const a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open VISTA authorization page ↗';$('#elicitation-fields').append(a);
  }else if(event.event_kind==='mcp_tool_approval'){
    const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;font-size:11px;overflow-wrap:anywhere';pre.textContent=JSON.stringify({tool:event.tool_name,args:event.args},null,2);$('#elicitation-fields').append(pre);
  }else{
    const schema=event.requested_schema || {},required=schema.required || [];
    for(const [name,property] of Object.entries(schema.properties || {})){
      const label=document.createElement('label');label.textContent=property.title || name;label.htmlFor=`elicit-${name}`;
      let input;
      if(Array.isArray(property.enum)){input=document.createElement('select');for(const choice of property.enum){const option=document.createElement('option');option.value=choice;option.textContent=choice;input.append(option);}}
      else{input=document.createElement('input');input.type=property.type==='boolean'?'checkbox':property.type==='number'||property.type==='integer'?'number':/token|secret|password|key/i.test(name)?'password':'text';if(input.type==='number')input.step=property.type==='integer'?'1':'any';}
      input.id=`elicit-${name}`;input.name=name;input.dataset.type=property.type;input.required=required.includes(name);input.autocomplete='off';
      if(property.default!=null){if(input.type==='checkbox')input.checked=property.default;else input.value=property.default;}
      $('#elicitation-fields').append(label,input);
      if(property.description){const hint=document.createElement('small');hint.textContent=property.description;$('#elicitation-fields').append(hint);}
    }
  }
  if(!$('#elicitation-dialog').open)$('#elicitation-dialog').showModal();
}
async function resolveElicitation(action) {
  if(!state.pending)return;
  const content={};
  for(const el of $$('#elicitation-fields input, #elicitation-fields select'))content[el.name]=el.type==='checkbox'?el.checked:['number','integer'].includes(el.dataset.type)?Number(el.value):el.value;
  try {await api(projectUrl('/elicitation'),{method:'POST',body:JSON.stringify({id:state.pending.elicitation_id,action,content:action==='accept'?content:null})});state.pending=null;$('#elicitation-fields').replaceChildren();$('#elicitation-dialog').close();$('#agent-state').textContent='Agent working';}
  catch(error){toast(error.message);}
}
async function exportBrief() {
  const button=$('#export-report');button.disabled=true;
  const reportScope=liveContext();
  try {
    if(!state.sessionId||!state.history.length){toast('Start a conversation before exporting its brief.');return;}
    const report=await api(projectUrl('/reports/generate'),{method:'POST',body:JSON.stringify({chat_session_id:state.sessionId,message_history:state.history,hint:isAprilContext()?'Write a concise evidence-grounded brief for the TVA hypothesis-lab demo, issued 15 April 2019 for 16–22 April 2019. Cite actual files and skill calls. Distinguish frozen 9×9 temperature/precipitation, observed ERA5 surface runoff, unavailable HEADWATER runoff forecast, and frozen Trial 0 downscaling. Include a dam readout only if an explicit reservoir, agreed rule and matching source artifact exist. Report missing evidence. Do not invent scores, new training, RiverWare, river temperature, releases or plant MW.':isLab24Context()?'Write a concise retrospective of the completed 24 October 2026 research cycle. Cite the actual records available in this conversation. Explain the soil-residual result and stopping decision using the public project summary or verified local sources, and identify any details the available records do not establish. Do not invent approval or execution records, or run jobs.':'Write a concise Water4Energy HEADWATER development brief from this conversation. Cite actual saved sources, distinguish H100 training from Lux run names, retain the comparison phrase the 1979–2017 week already in the example files, and report missing evidence. Do not invent scores or submit jobs.'})});
    if(!isLiveContext(reportScope))return;
    download((report.slug_suggestion || 'water4energy-brief')+'.md',`# ${report.title}\n\n${report.summary || ''}\n\n${report.body || ''}`,'text/markdown');toast('VISTA report draft downloaded. Review it before presenting.');
  }catch(error){toast(`Could not export brief: ${error.message}`);}finally{button.disabled=false;}
}


// Bind once. All execution actions originate in explicit user interaction.
$('#active-context').addEventListener('change',event=>selectContext(event.target.value));
document.addEventListener('click',event=>{const button=event.target?.closest?.('[data-project-context]');if(!button||button.disabled||!selectContext(button.dataset.projectContext))return;if(['development','introduction'].includes(state.view))switchView(button.dataset.projectContext==='headwater'?'development':button.dataset.projectContext==='lab24'?'introduction':'workspace');});
$$('.nav-item').forEach(el=>el.addEventListener('click',()=>switchView(el.dataset.view)));
$('.brand').addEventListener('click',event=>{event.preventDefault();switchView('development');});
$('#skills-topbar').addEventListener('click',()=>switchView('skills'));
$('#skills-refresh').addEventListener('click',async()=>{await refreshSkills();await refreshKnowledge();await refreshDemo();});
$('#demo-setup-button').addEventListener('click',showSettings);
$('#view-case-figures').addEventListener('click',openCaseFigures);
$('#site-search').addEventListener('input',renderNetworkRoster);
$('#connection-button').addEventListener('click',showSettings);
$('#refresh-button').addEventListener('click',()=>{refreshConnection();if(state.view==='files')renderFiles();toast('Checking the local VISTA connection.');});
$('#resource-refresh').addEventListener('click',refreshConnection);
$('#compute-refresh').addEventListener('click',refreshConnection);
$('#compute-settings').addEventListener('click',showSettings);
$$('[data-close-dialog]').forEach(el=>el.addEventListener('click',()=>el.closest('dialog').close()));
$('#settings-form').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy){$('#settings-status').textContent='Finish or stop the current turn before changing connections.';return;}
  const button=event.submitter;button.disabled=true;
  try{state.contextRevision++;state.drafts={};state.config=await api('/api/config',{method:'POST',body:JSON.stringify({backend_url:$('#backend-url').value.trim(),project:$('#project-name').value.trim()})});state.sessionId=null;state.history=[];state.liveFiles=[];state.liveStudy=null;state.status=null;state.skills=null;state.knowledge=null;state.demoEvidence=null;clearLiveConversation(true);TVAHypothesisDemo.reset();await refreshDemo();$('#skill-count').textContent='—';$('#skills-topbar-count').textContent='—';$('#settings-status').textContent='Checking VISTA…';await refreshConnection();resetActivity();showWelcome();renderResults();toast('Local connection saved.');}
  catch(error){$('#settings-status').textContent=error.message;}finally{button.disabled=false;}
});
$('#activity-toggle').addEventListener('click',()=>{const log=$('#activity-log');log.hidden=!log.hidden;$('#activity-toggle').setAttribute('aria-expanded',String(!log.hidden));});
$('#provenance-button').addEventListener('click',showProvenance);
$('#export-report').addEventListener('click',exportBrief);
$('#lab-history').addEventListener('click',()=>switchView('history'));
$('#history-back').addEventListener('click',()=>switchView('workspace'));
$('#new-chat').addEventListener('click',newConversation);$('#history-new').addEventListener('click',newConversation);


$('#chat-form').addEventListener('submit',event=>{event.preventDefault();const prompt=$('#prompt').value.trim();if(!prompt||state.busy)return;if(state.status?.project_found)$('#prompt').value='';sendLive(prompt);});
$('#prompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#chat-form').requestSubmit();}});
$('#stop-button').addEventListener('click',async()=>{
  if(!state.sessionId)return;
  try{await api(projectUrl(`/chat-sessions/${state.sessionId}/run/stop`),{method:'POST',body:'{}'});toast('Stop requested for the agent turn. Submitted cluster jobs must be checked separately.');}
  catch(error){toast(error.message);}
});
function chooseUpload(){if(!state.status?.project_found){toast('Open VISTA and connect your project first.');showSettings();return;}$('#upload-input').click();}
$('#attach-button').addEventListener('click',chooseUpload);
$('#upload-input').addEventListener('change',async event=>{await uploadFiles(event.target.files);event.target.value='';});
$('#reload-files').addEventListener('click',renderFiles);
$('#elicitation-form').addEventListener('submit',event=>{event.preventDefault();resolveElicitation('accept');});
$('#elicitation-decline').addEventListener('click',()=>resolveElicitation('decline'));
$('#elicitation-dialog').addEventListener('cancel',event=>{event.preventDefault();toast('Accept or decline this VISTA request so the workflow can continue.');});

async function init() {
  renderResources();renderResults();renderDemoStatus();
  try {
    const [geo,config,network,demoCase,prompts]=await Promise.all([api('/data/geo.json'),api('/api/config'),api('/data/network.json'),api('/data/demo-case.json'),api('/data/prompts.json')]);
    state.geo=geo;state.config=config;state.network=network;state.demoCase=demoCase;state.prompts=prompts.prompts;
    TVAHypothesisDemo.init({caseDefinition:demoCase,api,projectUrl,fileUrl,preparePrompt:prepareAprilPrompt,showDetails,toast});
    TVAHypothesisGuide.init({caseDefinition:demoCase,prompts:state.prompts,preparePrompt:prepareDemoPrompt,usePrompt,showFigures:openCaseFigures,showDetails,overviewOpen:false});
    Water4EnergyWorkflow.init({navigate:switchView,prepareQuestion:prepareProjectPrompt});
    TVACaseJourney.init({caseDefinition:demoCase,prompts:state.prompts,guide:TVAHypothesisGuide,preparePrompt:prepareAprilPrompt,prepareProjectPrompt,prepareLabPrompt,methodRequest:id=>Water4EnergyWorkflow.methodRequest(id),openCase:openTVACase,navigate:switchView});
    updateContextUI();
    dockConversation(state.view);
    api('/api/workbench-assets').then(assets=>Water4EnergyWorkflow.setAssets(assets)).catch(()=>{});
    TVAComposerResize.init();
    TVALiteratureLibrary.init({api,preparePrompt:prepareDemoPrompt,showDetails,toast});
    renderPromptLibrary();renderSkills();renderSiteContext();renderMap();renderResults();showWelcome();
    await refreshConnection();
    state.sessionId=readSessionId();
    if(state.sessionId && state.status?.project_found)await loadSession(state.sessionId,true);
  }catch(error){addMessage('system',`The workspace could not load: ${error.message}. Start it using the launcher rather than opening index.html directly.`,{error:true});}
}

init();
