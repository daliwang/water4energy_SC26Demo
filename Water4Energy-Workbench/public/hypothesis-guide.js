/* An explorable explanation, separate from agent execution and scientific results. */
(function (global) {
  'use strict';
  const FIXED_CASE=Object.freeze({start:'2019-04-16',end:'2019-04-22',issued:'2019-04-15'});
  const PROJECT='Water4Energy-TVA-agent-loop';
  const OUTPUT_PREFIX='/api/vista/projects/'+encodeURIComponent(PROJECT)+'/outputs/';
  const SOURCE_STEPS=new Set(['ledger','proposer','critic','referee','human']);
  const RASTER=/\.(?:png|jpe?g|gif|webp)$/i;
  const SKILL_STAGES=Object.freeze({'lab.ledger':'ledger','lab.board':'ledger','lab.literature':'ledger','lab.download':'ledger','lab.design':'proposer','lab.show_command':'human','lab.realize':'evidence','downscale.scorecard':'evidence','display_file':'evidence'});
  const CASE_HEADER='Case: 16–22 April 2019, issued 15 April 2019, in '+PROJECT+'.';
  const FALLBACK_CONTEXT=CASE_HEADER+' Start from the HEADWATER experiment ledger and allowlisted source files. Treat temperature and precipitation as the frozen det_v2_soil_k9 realization, runoff as ERA5 observed sro with no HEADWATER runoff forecast, and downscaling as the existing frozen Trial 0 1° to 0.25° comparison scored 7 September 2026. Do not submit jobs, execute training commands, retrain, download ERA5, change settings, or invent figures or scores. Report missing files or skills explicitly. Read and cite saved source files; do not claim a role ran or approval was granted without recorded evidence.';
  const STEPS=Object.freeze([
    {id:'ledger',label:'Read records',title:'Read the ledger',role:'Ledger',promptId:'ledger',
      description:'Start with what was already tested. Separate scored, closed and blocked experiments from questions that are still open.',
      expected:'Ledger rows and cited source files',
      question:'What have we already learned for 16–22 April 2019?',
      focus:'Use lab.ledger and lab.board to explain what the saved ledger already establishes and which questions remain open. Consult local literature only for those open gaps.'},
    {id:'proposer',label:'Propose an idea',title:'Propose an idea',role:'Proposer',promptId:'design',
      description:'Turn an open question into a testable idea. Explain what would change from an experiment that was already tried.',
      expected:'A proposed test and its stated difference',
      question:'What testable idea addresses an open gap in this case?',
      focus:'Focus on the Proposer. Use lab.design, the April charge and ledger to inspect a saved proposal, if present. Identify its hypothesis, proposed test and meaningful difference from already-tested runs. Distinguish a proposed protocol from a reviewed one. If no proposal artifact exists, report that rather than claiming the Proposer ran.'},
    {id:'critic',label:'Challenge it',title:'Challenge the idea',role:'Critic',promptId:'design',
      description:'Check the idea against the evidence. An already-tested or blocked proposal needs a meaningful change before it can be reconsidered.',
      expected:'Recorded objections and missing evidence',
      question:'Where could this proposal be wrong, or repeat a tested idea?',
      focus:'Focus on the Critic. Inspect saved proposal and Critic artifacts, if present. Check the ledger for an already-tested or blocks_reproposal experiment without a meaningful stated change. Explain recorded objections, unsupported claims and missing evidence. Do not invent a critique or claim the Critic ran when its saved artifact is absent.'},
    {id:'referee',label:'Review evidence',title:'Review the evidence',role:'Referee',promptId:'design',
      description:'Weigh the proposal and critique together. Read the recorded review to see which protocol is supported and what remains unresolved.',
      expected:'A recorded review status and unresolved tests',
      question:'What does the saved review support, and what is unresolved?',
      focus:'Focus on the Referee. Inspect saved proposal, Critic and Referee artifacts, if present. Explain the recorded review status, supported protocol and unresolved tests. Cite each source. Do not infer approval from a proposal, invent a Referee decision, or claim a multi-agent review ran without saved evidence. Human training approval remains separate.'},
    {id:'human',label:'Human review',title:'Keep a person in the loop',role:'Human gate',promptId:'commands',
      description:'A person decides whether future training may proceed. Here, inspect the existing command and its source without executing it.',
      expected:'Command references for a person to review',
      question:'Which existing commands would a person need to review?',
      focus:'Focus on human review. Use lab.show_command to display existing 9×9 training and Trial 0 scoring command/config references and their provenance. Explain the human training-flag approval gate. Print commands only; do not execute them, submit jobs, set an approval flag or treat this question as authorization.'},
    {id:'evidence',label:'Inspect results',title:'Inspect the saved evidence',role:'Evidence',promptId:'realization',
      description:'Read frozen temperature and precipitation results, observed ERA5 runoff (no HEADWATER forecast), and the frozen Trial 0 downscale comparison. Findings return to the ledger.',
      expected:'Existing figures, score files and remaining gaps',
      question:'What do the saved April figures show, and what remains unknown?',
      focus:'Use lab.realize and downscale.scorecard to inspect existing case figures and their source JSON. Temperature and precipitation are frozen det_v2_soil_k9 results. Runoff is observed ERA5 sro; its HEADWATER forecast is unavailable. Downscaling is the frozen Trial 0 1° to 0.25° comparison, not a new training run. Identify which findings inform the ledger and what is still missing. Do not draw substitute figures, alter scores or record a new experiment as completed.'}
  ].map(step=>Object.freeze(step)));
  const escapeHTML=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let options=null,root=null,selectedId='ledger',researchSources=[],caseFigures=[],conversationFigures=[];
  let following=true,lastActualStage=null,turnStatus='Waiting for conversation',lastToolEvent=null,galleryRequested=false,gallerySignature=null,activeFigureKey=null,lastDisplayedFigureKey=null;
  const toolCalls=new Map();

  function matchesCase(definition) {
    return Boolean(definition && definition.project===PROJECT && definition.case && Object.keys(FIXED_CASE).every(key=>definition.case[key]===FIXED_CASE[key]));
  }
  function requestFor(id,settings={}) {
    const step=STEPS.find(item=>item.id===id);
    if(!step || !matchesCase(settings.caseDefinition))return null;
    const catalog=Array.isArray(settings.prompts)?settings.prompts:[];
    const candidate=catalog.find(prompt=>prompt?.id===step.promptId)?.livePrompt;
    // Keep the supplied catalog context only when it belongs to this fixed case.
    const base=typeof candidate==='string' && candidate.startsWith(CASE_HEADER) && candidate.includes('Do not submit jobs')?candidate:FALLBACK_CONTEXT;
    return step.question+'\n\n'+base+'\n\nGuide focus — '+step.role+': '+step.focus;
  }
  function validatedResearchSources(entries,definition) {
    if(!matchesCase(definition) || !Array.isArray(entries))return [];
    const seen=new Set();
    return entries.filter(entry=>{
      if(!entry || !SOURCE_STEPS.has(entry.step) || typeof entry.name!=='string' || typeof entry.url!=='string')return false;
      const name=entry.name;
      if(!name || name.length>1024 || name.startsWith('/') || /[\\\u0000-\u001f\u007f%?#:]/.test(name) || name.split('/').some(part=>!part || part==='.' || part==='..'))return false;
      let expected;
      try {expected=OUTPUT_PREFIX+name.split('/').map(encodeURIComponent).join('/');}catch{return false;}
      if(entry.url!==expected || seen.has(entry.step+'\n'+expected))return false;
      seen.add(entry.step+'\n'+expected);return true;
    }).map(entry=>({step:entry.step,name:entry.name,url:entry.url}));
  }
  function renderSources() {
    if(!root)return;
    const container=root.querySelector('[data-guide-sources]');
    if(!container)return;
    if(!matchesCase(options?.caseDefinition))researchSources=[];
    const sources=researchSources.filter(source=>source.step===selectedId);
    container.hidden=!sources.length;
    container.innerHTML=sources.length?`<div class="hypothesis-guide-source-heading"><h3>Saved source${sources.length===1?'':'s'}</h3><span>April case</span></div>${sources.map(source=>`<a class="hypothesis-guide-source-link" href="${escapeHTML(source.url)}" download><span>${escapeHTML(source.name)}</span><span aria-hidden="true">↧</span></a>`).join('')}`:'';
  }
  function setResearchSources(entries) {
    // The case adapter supplies only files from its matched manifest. Validate
    // the project-scoped URL again before retaining or displaying any link.
    researchSources=validatedResearchSources(entries,options?.caseDefinition);
    renderSources();
    if(lastToolEvent)followActualStage(stageForEvent(lastToolEvent.type,lastToolEvent.event,researchSources));
    return researchSources.length;
  }
  function scopedURL(name,url,preview=false) {
    if(typeof name!=='string' || !name || name.length>1024 || name.startsWith('/') || /[\\\u0000-\u001f\u007f%?#:]/.test(name) || name.split('/').some(part=>!part || part==='.' || part==='..'))return false;
    let expected;try{expected=OUTPUT_PREFIX+name.split('/').map(encodeURIComponent).join('/');}catch{return false;}
    return url===expected || (preview && url===expected+'?preview=true');
  }
  function validatedCaseFigures(entries,definition) {
    if(!matchesCase(definition) || !Array.isArray(entries))return [];
    const kinds={temperature:'frozen_prediction',precipitation:'frozen_prediction',runoff:'observation',downscale:'frozen_comparison'},seen=new Set();
    return entries.filter(entry=>{
      if(!entry || !Object.hasOwn(kinds,entry.id) || entry.kind!==kinds[entry.id] || seen.has(entry.id))return false;
      if(!RASTER.test(entry.figure) || !scopedURL(entry.figure,entry.figureUrl,true) || !/\.json$/i.test(entry.sourceFile) || !scopedURL(entry.sourceFile,entry.sourceUrl))return false;
      if(typeof entry.source!=='string' || !entry.source.trim())return false;
      seen.add(entry.id);return true;
    }).map(entry=>({id:entry.id,title:String(entry.title || entry.id),subtitle:String(entry.subtitle || ''),kind:entry.kind,figure:entry.figure,figureUrl:entry.figureUrl,sourceFile:entry.sourceFile,sourceUrl:entry.sourceUrl,source:entry.source,downloadUrl:OUTPUT_PREFIX+entry.figure.split('/').map(encodeURIComponent).join('/')}));
  }
  function validatedConversationFigures(entries,definition) {
    if(!matchesCase(definition) || !Array.isArray(entries))return [];
    const seen=new Set();
    return entries.filter(entry=>{
      if(!entry || !RASTER.test(entry.name) || !scopedURL(entry.name,entry.url,true) || !scopedURL(entry.name,entry.downloadUrl) || seen.has(entry.name))return false;
      seen.add(entry.name);return true;
    }).map(entry=>{
      const figure={name:entry.name,url:entry.url,downloadUrl:entry.downloadUrl};
      if(typeof entry.displayId==='string' && entry.displayId.length<=384 && !/[\u0000-\u001f\u007f]/.test(entry.displayId))figure.displayId=entry.displayId;
      if(typeof entry.shownAt==='string' && entry.shownAt.length<=64 && Number.isFinite(Date.parse(entry.shownAt)))figure.shownAt=new Date(entry.shownAt).toISOString();
      return figure;
    });
  }
  function structuredArguments(event) {
    let args=event?.part?.args ?? event?.part?.arguments ?? event?.args ?? event?.arguments;
    if(typeof args==='string') {if(args.length>50000)return null;try{args=JSON.parse(args);}catch{return null;}}
    return args && typeof args==='object' && !Array.isArray(args)?args:null;
  }
  function stageForEvent(type,event,sources=[]) {
    if(!['function_tool_call','function_tool_result'].includes(type) || !event || typeof event!=='object')return null;
    const tool=event.part?.tool_name ?? event.tool_name;
    if(typeof tool!=='string')return null;
    const args=structuredArguments(event);
    if(args && ['project','project_name'].some(key=>typeof args[key]==='string' && args[key]!==PROJECT))return null;
    // A read of an exact manifest-validated research path can identify a role;
    // free text, arbitrary nested strings and mere role names cannot.
    if(args)for(const key of ['path','file_path','filename','file_name','source_file']) {
      if(typeof args[key]!=='string')continue;
      const source=sources.find(item=>item.name===args[key] || item.url===args[key]);
      if(source && SOURCE_STEPS.has(source.step))return source.step;
    }
    if(Object.hasOwn(SKILL_STAGES,tool))return SKILL_STAGES[tool];
    if(args)for(const key of ['skill_name','skill_id','skill']) {
      if(typeof args[key]==='string' && Object.hasOwn(SKILL_STAGES,args[key]) && args[key]!=='display_file')return SKILL_STAGES[args[key]];
    }
    return null;
  }
  function renderFollowing() {
    if(!root)return;
    const status=root.querySelector('[data-guide-status]'),mode=root.querySelector('[data-guide-mode]'),resume=root.querySelector('[data-guide-resume]');
    if(status && status.textContent!==turnStatus)status.textContent=turnStatus;
    if(mode)mode.textContent=following?'Following conversation':'Manual review';
    if(resume)resume.hidden=following;
    root.classList.toggle('following-conversation',following);
  }
  function collapseWorkflow(){const workflow=root?.querySelector('[data-guide-overview]');if(workflow)workflow.open=false;}
  function followActualStage(stage) {
    if(!stage)return;
    lastActualStage=stage;
    if(following && stage==='evidence')collapseWorkflow();
    if(following && selectedId!==stage){selectedId=stage;renderDetail(true);}
  }
  function beginTurn() {
    following=true;
    turnStatus='Waiting for tool activity';lastToolEvent=null;toolCalls.clear();renderFollowing();
  }
  function finishTurn(value) {
    const state=typeof value==='string'?value:value?.state;
    const label=typeof value==='string'?value:value?.label;
    const actualState=state ?? label;
    if(['done','completed','Turn completed'].includes(actualState))turnStatus='Turn completed';
    else if(['failed','error','Turn failed'].includes(actualState))turnStatus='Turn failed';
    else if(['cancelled','canceled','stopped','Turn stopped'].includes(actualState))turnStatus='Turn stopped';
    else if(['interrupted','disconnected','Connection interrupted'].includes(actualState))turnStatus='Connection interrupted';
    else turnStatus='Turn ended';
    renderFollowing();
  }
  function handleEvent(type,event={}) {
    if(!root)return;
    if(type==='run_started'){turnStatus='Agent working';renderFollowing();return;}
    if(['function_tool_call','function_tool_result'].includes(type)) {
      turnStatus='Tool activity';
      let activity={type,event};
      const id=event.part?.tool_call_id ?? event.tool_call_id;
      if(type==='function_tool_call' && typeof id==='string') {
        toolCalls.set(id,activity);
        if(toolCalls.size>64)toolCalls.delete(toolCalls.keys().next().value);
      } else if(type==='function_tool_result' && !structuredArguments(event)) {
        // Tool returns often omit their call's arguments. Keep the actual call
        // so a source validated a moment later can still identify its topic.
        const call=typeof id==='string'?toolCalls.get(id):null;
        const tool=event.part?.tool_name ?? event.tool_name;
        if(call)activity=call;
        else if(!id && lastToolEvent?.type==='function_tool_call' && tool===(lastToolEvent.event.part?.tool_name ?? lastToolEvent.event.tool_name))activity=lastToolEvent;
      }
      lastToolEvent=activity;
      followActualStage(stageForEvent(activity.type,activity.event,researchSources));renderFollowing();return;
    }
    if(type==='run_finished'){finishTurn(event);return;}
    if(['mcp_form_elicitation','mcp_url_elicitation','mcp_tool_approval'].includes(type)){turnStatus='Waiting for input';renderFollowing();}
    // Text deltas and arbitrary log/custom payloads never identify a lab stage.
  }
  function resumeFollowing() {
    following=true;
    if(lastActualStage && selectedId!==lastActualStage){selectedId=lastActualStage;renderDetail(true);}
    if(lastActualStage==='evidence')collapseWorkflow();
    if(lastDisplayedFigureKey){activeFigureKey=lastDisplayedFigureKey;renderGallery();}
    renderFollowing();
  }
  function galleryEntries() {
    const caseNames=new Set(caseFigures.map(figure=>figure.figure));
    return {cases:caseFigures,conversation:conversationFigures.filter(figure=>!caseNames.has(figure.name))};
  }
  function figurePreviewHTML(figure,checked) {
    const name=checked?figure.figure:figure.name,title=checked?figure.title:name,url=checked?figure.figureUrl:figure.url;
    const note=checked?figure.source:'Displayed in this conversation; April case association is unverified.';
    return `<figure class="hypothesis-guide-large-figure"><img src="${escapeHTML(url)}" alt="${escapeHTML(title)}"><figcaption>${escapeHTML(note)}</figcaption></figure><p class="hypothesis-guide-preview-links"><a href="${escapeHTML(figure.downloadUrl)}" download>Download figure ↧</a>${checked?` <a href="${escapeHTML(figure.sourceUrl)}" download>Source JSON ↧</a>`:''}</p>`;
  }
  function openFigure(index,checked) {
    const groups=galleryEntries(),figure=(checked?groups.cases:groups.conversation)[index];if(!figure)return;
    const html=(checked?`<p class="hypothesis-guide-preview-kind">${escapeHTML(figure.subtitle)}</p>`:'')+figurePreviewHTML(figure,checked);
    if(typeof options.showDetails==='function')options.showDetails(checked?figure.title:figure.name,html);
    else {const expanded=root.querySelector('[data-guide-expanded]');if(expanded){expanded.innerHTML=html;expanded.hidden=false;}}
  }
  function figureKey(figure,checked){return (checked?'case:':'conversation:')+(checked?figure.figure:figure.name);}
  function selectFigure(index,checked){
    const groups=galleryEntries(),figure=(checked?groups.cases:groups.conversation)[index];if(!figure)return false;
    activeFigureKey=figureKey(figure,checked);following=false;renderFollowing();renderGallery();
    root.querySelector('[data-evidence-current]')?.focus?.({preventScroll:true});return true;
  }
  function renderGallery(force=false) {
    if(!root)return;
    const container=root.querySelector('[data-guide-gallery]');if(!container)return;
    const groups=galleryEntries(),items=[...groups.cases.map((figure,index)=>({figure,index,checked:true})),...groups.conversation.map((figure,index)=>({figure,index,checked:false}))],count=items.length;
    root.classList.toggle('has-guide-figures',count>0);
    const countButton=root.querySelector('[data-guide-figure-count]');
    if(countButton){countButton.hidden=!count;countButton.textContent=count+' figure'+(count===1?'':'s');}
    if(!items.some(item=>figureKey(item.figure,item.checked)===activeFigureKey))activeFigureKey=count?figureKey(items[0].figure,items[0].checked):null;
    // Display identity drives following, not image markup. Redisplaying the
    // same already-focused file need not rebuild its image or steal scroll.
    const signature=JSON.stringify({groups:{cases:groups.cases,conversation:groups.conversation.map(({name,url,downloadUrl})=>({name,url,downloadUrl}))},activeFigureKey,requested:galleryRequested});
    if(!force && signature===gallerySignature)return;
    gallerySignature=signature;container.hidden=false;
    if(!count){container.innerHTML='<div class="evidence-empty"><h3>Awaiting saved figures</h3><p>Figures load from the selected VISTA project. Experiment records and source files appear below when available.</p></div><div data-guide-expanded hidden></div>';return;}
    const selected=items.find(item=>figureKey(item.figure,item.checked)===activeFigureKey),{figure,index,checked}=selected;
    const name=checked?figure.figure:figure.name,title=checked?figure.title:name,url=checked?figure.figureUrl:figure.url;
    const subtitle=checked?figure.subtitle:'Displayed in this conversation. April case association is unverified.';
    const filmstrip=items.map(item=>{
      const f=item.figure,key=figureKey(f,item.checked),active=key===activeFigureKey,label=item.checked?f.title:f.name,img=item.checked?f.figureUrl:f.url;
      return `<button type="button" class="evidence-thumbnail" data-guide-open-figure="${item.index}" data-case-figure="${item.checked?'true':'false'}"${active?' data-evidence-current':''} aria-pressed="${active}" aria-label="Show ${escapeHTML(label)}"><img src="${escapeHTML(img)}" alt="" loading="lazy"><span>${escapeHTML(label)}</span></button>`;
    }).join('');
    container.innerHTML=`<div class="evidence-figure-heading"><h3>${escapeHTML(title)}</h3><button type="button" class="text-button" data-evidence-enlarge aria-label="Enlarge ${escapeHTML(title)}">Enlarge ↗</button></div><p class="evidence-figure-context">${checked?'Case figures · April metadata checked':'Conversation figures · Case not verified'}</p><p class="evidence-figure-subtitle">${escapeHTML(subtitle)}</p><figure class="evidence-main-figure"><button type="button" data-evidence-enlarge-image aria-label="Enlarge ${escapeHTML(title)} image"><img src="${escapeHTML(url)}" alt="${escapeHTML(title)}"></button></figure><div class="evidence-provenance"><code>${escapeHTML(name)}</code><div><a href="${escapeHTML(figure.downloadUrl)}" download>Download figure ↧</a>${checked?`<a href="${escapeHTML(figure.sourceUrl)}" download>Source JSON ↧</a>`:''}</div></div><div class="evidence-filmstrip" role="group" aria-label="Available figures">${filmstrip}</div><div class="hypothesis-guide-expanded" data-guide-expanded hidden></div>`;
    container.querySelectorAll('[data-guide-open-figure]').forEach(button=>button.addEventListener('click',()=>selectFigure(Number(button.dataset.guideOpenFigure),button.dataset.caseFigure==='true')));
    container.querySelector('[data-evidence-enlarge]')?.addEventListener('click',()=>openFigure(index,checked));
    container.querySelector('[data-evidence-enlarge-image]')?.addEventListener('click',()=>openFigure(index,checked));
  }
  function setCaseFigures(entries) {
    caseFigures=validatedCaseFigures(entries,options?.caseDefinition);renderGallery();
    return caseFigures.length;
  }
  function setConversationFigures(entries) {
    const identity=figure=>figure.name+'\n'+figure.url+'\n'+(figure.displayId || figure.shownAt || '');
    const before=new Set(conversationFigures.map(identity));
    conversationFigures=validatedConversationFigures(entries,options?.caseDefinition);
    const added=conversationFigures.filter(figure=>!before.has(identity(figure)));
    if(added.length){
      const latest=added[added.length-1],checked=caseFigures.find(item=>item.figure===latest.name);
      lastDisplayedFigureKey=figureKey(checked || latest,Boolean(checked));
      // A successful display of a manifest image selects its checked case
      // card, retaining the source JSON and scientific metadata.
      if(following){activeFigureKey=lastDisplayedFigureKey;collapseWorkflow();}
    }
    renderGallery();
    return conversationFigures.length;
  }
  function showFigures() {
    galleryRequested=true;collapseWorkflow();renderGallery();
    const container=root?.querySelector('[data-guide-gallery]');
    container?.focus?.({preventScroll:true});container?.scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }
  function resetConversation() {
    conversationFigures=[];following=true;lastActualStage=null;lastToolEvent=null;toolCalls.clear();selectedId='ledger';turnStatus='Waiting for conversation';galleryRequested=false;activeFigureKey=null;lastDisplayedFigureKey=null;
    const workflow=root?.querySelector('[data-guide-overview]');if(workflow)workflow.open=options?.overviewOpen!==false;
    if(root){renderDetail();renderFollowing();renderGallery();}
  }
  function renderDetail(announce=false) {
    const step=STEPS.find(item=>item.id===selectedId);
    const canPrepare=matchesCase(options.caseDefinition) && typeof options.preparePrompt==='function';
    root.querySelectorAll('[data-guide-step]').forEach(button=>{
      const selected=button.dataset.guideStep===selectedId;
      button.setAttribute('aria-pressed',String(selected));
      button.classList.toggle('selected',selected);
    });
    root.querySelector('[data-guide-detail]').innerHTML=`<div class="evidence-topic"><h3 id="hypothesis-guide-detail-title">${escapeHTML(step.title)}</h3><details class="evidence-topic-help"${following?'':' open'}><summary>About this step</summary><p>${escapeHTML(step.description)}</p><p class="evidence-expected">${escapeHTML(step.expected)}</p><p class="evidence-topic-question">${escapeHTML(step.question)}</p><button type="button" class="text-button" data-guide-prepare${canPrepare?'':' disabled'}>Ask about this step ↗</button>${step.id==='evidence'?'<button type="button" class="text-button" data-guide-figures>View figures</button>':''}<p class="evidence-topic-scope">A topic identifies a source being inspected, not a completed review or approval.</p></details></div>${canPrepare?'':`<p class="hypothesis-guide-unavailable">${matchesCase(options.caseDefinition)?'The conversation composer is unavailable.':'Questions are available for the fixed 16–22 April 2019 demo case.'}</p>`}`;
    root.querySelector('[data-guide-prepare]').addEventListener('click',()=>{
      const request=requestFor(selectedId,options);
      if(request && typeof options.preparePrompt==='function')options.preparePrompt(request,step.title);
    });
    const figures=root.querySelector('[data-guide-figures]');
    if(figures)figures.addEventListener('click',()=>typeof options.showFigures==='function'?options.showFigures():showFigures());
    renderSources();
    if(announce)root.querySelector('[data-guide-announcement]').textContent=step.title+' selected. '+step.description;
  }
  function selectStep(id) {
    if(!root || !STEPS.some(step=>step.id===id))return false;
    following=false;selectedId=id;renderDetail(true);renderFollowing();return true;
  }
  function init(settings={}) {
    root=global.document?.querySelector('#hypothesis-guide');
    if(!root)return false;
    options=settings;selectedId='ledger';researchSources=[];caseFigures=[];conversationFigures=[];following=true;lastActualStage=null;lastToolEvent=null;toolCalls.clear();turnStatus='Waiting for conversation';galleryRequested=false;activeFigureKey=null;lastDisplayedFigureKey=null;gallerySignature=null;
    root.innerHTML=`<header class="evidence-workspace-header"><div><h2>Evidence</h2><p>16–22 April 2019</p></div><button type="button" class="text-button evidence-figure-count" data-guide-figure-count aria-controls="hypothesis-guide-gallery" hidden></button></header><div class="evidence-follow"><span data-guide-mode>Following conversation</span><span data-guide-status role="status" aria-live="polite">Waiting for conversation</span><button type="button" class="text-button" data-guide-resume hidden>Resume following</button></div><details class="hypothesis-guide-overview evidence-workflow" data-guide-overview${options.overviewOpen===false?'':' open'}><summary><span>Workflow reference</span><span aria-hidden="true">⌄</span></summary><header class="hypothesis-guide-heading"><p>Turn a question into a testable, reviewed idea.</p></header><div class="hypothesis-guide-map"><svg class="hypothesis-guide-connectors" viewBox="0 0 336 174" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><marker id="hypothesis-guide-arrow" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6Z"/></marker></defs><g marker-end="url(#hypothesis-guide-arrow)"><path d="M148 26H186"/><path d="M252 46V60"/><path d="M188 80H150"/><path d="M84 100V114"/><path d="M148 134H186"/><path class="hypothesis-guide-return" d="M252 154V166H7V26H18"/></g></svg><div class="hypothesis-guide-nodes" role="group" aria-label="Explore the six steps of hypothesis lab">${STEPS.map((step,index)=>`<button type="button" class="hypothesis-guide-node hypothesis-guide-node-${escapeHTML(step.id)}" data-guide-step="${escapeHTML(step.id)}" aria-pressed="${index===0?'true':'false'}" aria-controls="hypothesis-guide-detail" aria-label="${escapeHTML(step.title+' — '+step.role)}"><span class="hypothesis-guide-node-number" aria-hidden="true">${index+1}</span><span class="hypothesis-guide-node-copy"><strong>${escapeHTML(step.label)}</strong><small>${escapeHTML(step.role)}</small></span></button>`).join('')}</div><span class="hypothesis-guide-return-label">Findings return to the ledger</span></div><p class="hypothesis-guide-caption">Explore the workflow · selection does not run agents</p></details><section id="hypothesis-guide-detail" data-guide-detail aria-labelledby="hypothesis-guide-detail-title"></section><section id="hypothesis-guide-gallery" data-guide-gallery aria-label="Evidence figures" tabindex="-1"></section><section class="evidence-sources" data-guide-sources aria-label="Saved files for the selected step" hidden></section><p class="sr-only" data-guide-announcement role="status" aria-live="polite" aria-atomic="true"></p>`;
    root.querySelectorAll('[data-guide-step]').forEach(button=>button.addEventListener('click',()=>selectStep(button.dataset.guideStep)));
    root.querySelector('[data-guide-resume]').addEventListener('click',resumeFollowing);
    root.querySelector('[data-guide-figure-count]').addEventListener('click',showFigures);
    renderDetail();renderFollowing();renderGallery();return true;
  }
  const api={init,setResearchSources,setCaseFigures,setConversationFigures,beginTurn,handleEvent,finishTurn,resetConversation,showFigures,selectFigure,steps:STEPS,requestFor,matchesCase,validatedResearchSources,validatedCaseFigures,validatedConversationFigures,stageForEvent};
  global.TVAHypothesisGuide=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
