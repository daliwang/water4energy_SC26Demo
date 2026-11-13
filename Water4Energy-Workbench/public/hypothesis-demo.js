/* Live VISTA orchestration; scientific figures stay backed by named output files. */
(function (global) {
  'use strict';
  const FIXED_CASE = {start:'2019-04-16',end:'2019-04-22',issued:'2019-04-15'};
  const MANIFEST_NAME = 'tva-demo-20190416-20190422.json';
  const CORE_SKILLS = ['lab.literature','lab.download','lab.ledger','lab.board','lab.design','lab.show_command','lab.realize','downscale.scorecard'];
  const RASTER = /\.(?:png|jpe?g|gif|webp)$/i;
  const $ = selector => document.querySelector(selector);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options = null, definition = null, context = null, capabilities = null, evidence = null, revision = 0;
  const damState = {enabled:false,reservoir:'',rule:'',source:null,sourceName:null};

  function validPath(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
      !value.startsWith('/') && !/[\\\u0000-\u001f\u007f%?#:]/.test(value) &&
      value.split('/').every(part=>part!=='' && part!=='.' && part!=='..');
  }
  function matchesCase(value, expected=FIXED_CASE) {
    return Boolean(value && typeof value==='object' && ['start','end','issued'].every(key=>value[key]===expected[key]));
  }
  function dateInCase(value, expected=FIXED_CASE) {
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const timestamp=Date.parse(value+'T12:00:00Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0,10)===value && value>=expected.start && value<=expected.end;
  }
  function fileNames(files) {
    return new Set(Array.isArray(files)?files.filter(file=>file && validPath(file.name)).map(file=>file.name):[]);
  }
  function panelValidation(id, panel, names, expected=FIXED_CASE) {
    const errors=[];
    if(!panel || typeof panel!=='object')return {available:false,errors:['No panel record in the case manifest.']};
    if(typeof panel.source!=='string' || !panel.source.trim())errors.push('A source description is required.');
    if(!validPath(panel.figure) || !RASTER.test(panel.figure) || !names.has(panel.figure))errors.push('The named raster figure is not present in project outputs.');
    if(!validPath(panel.source_file) || !/\.json$/i.test(panel.source_file) || panel.source_file===MANIFEST_NAME || !names.has(panel.source_file))errors.push('The backing source JSON is not present in project outputs.');
    if(id==='temperature' || id==='precipitation') {
      if(panel.kind!=='frozen_prediction' || panel.model!=='det_v2_soil_k9')errors.push('Expected the frozen det_v2_soil_k9 prediction.');
    } else if(id==='runoff') {
      if(panel.kind!=='observation' || panel.dataset!=='ERA5' || panel.variable!=='sro' || panel.forecast_available!==false)errors.push('Runoff must be ERA5 sro observation, with the HEADWATER forecast unavailable.');
    } else if(id==='downscale') {
      if(panel.kind!=='frozen_comparison' || panel.trial!=='Trial 0' || panel.scored!=='2026-09-07' || panel.input_resolution_deg!==1 || panel.output_resolution_deg!==0.25)errors.push('Expected the frozen Trial 0 1° to 0.25° comparison scored 7 September 2026.');
      if(!dateInCase(panel.date,expected))errors.push('The downscale figure date must be inside the fixed case week.');
    }
    return {available:errors.length===0,errors,panel};
  }
  function validateManifest(data, files, expected=FIXED_CASE) {
    const names=fileNames(files),errors=[];
    if(!data || typeof data!=='object' || data.schema_version!==1)errors.push('Expected evidence schema_version 1.');
    if(!matchesCase(data?.case,expected))errors.push('The manifest issue date and valid week do not match this demo.');
    if(data?.example_only!==undefined && data.example_only!==false)errors.push('A contract example cannot be used as scientific evidence.');
    const panels={};
    for(const id of ['temperature','precipitation','runoff','downscale'])panels[id]=errors.length?{available:false,errors:[...errors]}:panelValidation(id,data.panels?.[id],names,expected);
    const research={};
    if(!errors.length)for(const key of ['ledger_file','proposal_file','critic_file','referee_file','protocol_file']) {
      const path=data.research?.[key];
      if(validPath(path) && names.has(path))research[key]=path;
    }
    return {matched:errors.length===0,errors,panels,research,data:errors.length?null:data,names};
  }
  function skillReadiness(skills, expectedProject) {
    const known=Boolean(skills?.project_found && skills.project===expectedProject && Number.isInteger(skills.count));
    const names=known?(skills.skills || []).filter(skill=>skill && typeof skill.name==='string').map(skill=>skill.name):[];
    // Current VISTA requires kebab-case names; the demo retains its original contract IDs.
    const loaded=new Set([...CORE_SKILLS,'dam.readout'].filter(id=>names.includes(id)||names.includes(id.replace(/[._]/g,'-'))));
    return {known,loaded:known?CORE_SKILLS.filter(name=>loaded.has(name)).length:null,
      required:CORE_SKILLS.map(name=>({name,state:known?(loaded.has(name)?'loaded':'missing'):'unknown'})),
      optional:known?(loaded.has('dam.readout')?'loaded':'missing'):'unknown'};
  }
  function normalizeName(value) {return String(value || '').replace(/\\/g,'/').replace(/\.(?:md|txt|pdf|json)$/i,'').toLowerCase().replace(/[^a-z0-9/]+/g,' ').trim();}
  function sourceMatches(source, document) {
    const filename=String(document.filename || '').replace(/\\/g,'/');
    const title=normalizeName(document.title);
    return (source.paths || []).some(path=>filename.toLowerCase()===path.toLowerCase() || filename.toLowerCase().endsWith('/'+path.toLowerCase())) ||
      Boolean(title && (source.titles || []).some(value=>normalizeName(value)===title));
  }
  function knowledgeCoverage(knowledge, sources, expectedProject) {
    const known=Boolean(knowledge?.project_found && knowledge.project===expectedProject && Number.isInteger(knowledge.count));
    const rows=sources.map(source=>{
      if(!known)return {source,state:'unknown'};
      const matches=[];
      for(const kb of knowledge.knowledge_bases || [])for(const document of kb.documents || [])if(sourceMatches(source,document))matches.push({kb,document});
      if(!matches.length)return {source,state:'not-listed'};
      const indexed=matches.some(({kb,document})=>kb.ready===true && document.index_status==='indexed');
      return {source,state:indexed?'listed-ready-index':'listed'};
    });
    return {known,listed:known?rows.filter(row=>row.state.startsWith('listed')).length:null,rows};
  }
  function normalizedRule(value) {return typeof value==='string'?value.trim().replace(/\s+/g,' '):'';}
  function validateDamReadout(data, selection, manifestation, expected=FIXED_CASE) {
    if(!selection.enabled)return {available:false,reason:'The optional panel is off.'};
    if(!['Normandy','Norris'].includes(selection.reservoir) || !normalizedRule(selection.rule))return {available:false,reason:'Choose one reservoir and enter the agreed plain-language rule.'};
    if(!data || !matchesCase(data.case,expected))return {available:false,reason:'No readout JSON matching the fixed case is loaded.'};
    if(data.reservoir!==selection.reservoir || normalizedRule(data.rule)!==normalizedRule(selection.rule))return {available:false,reason:'The saved reservoir and rule must match your selections.'};
    if(!['fill','hold'].includes(data.decision))return {available:false,reason:'The saved readout must state fill or hold.'};
    const allowed=new Set(['temperature','precipitation','runoff'].filter(id=>manifestation?.panels?.[id]?.available).map(id=>manifestation.panels[id].panel.source_file).filter(Boolean));
    if(!validPath(data.realization_source_file) || !allowed.has(data.realization_source_file) || !manifestation?.names?.has(data.realization_source_file))return {available:false,reason:'The readout must cite a case realization JSON present in project outputs.'};
    return {available:true,decision:data.decision,reservoir:data.reservoir,rule:data.rule,source:data.realization_source_file};
  }
  function outputURL(name, base=context?.outputBase) {
    if(!validPath(name) || typeof base!=='string' || !/^\/api\/vista\/projects\/[^/]+\/outputs$/.test(base))throw new Error('Invalid scoped output reference.');
    return base+'/'+name.split('/').map(encodeURIComponent).join('/');
  }
  function researchLinks(manifestation, base) {
    if(!manifestation?.matched)return [];
    const steps={ledger_file:'ledger',proposal_file:'proposer',critic_file:'critic',referee_file:'referee',protocol_file:'human'};
    return Object.entries(steps).flatMap(([key,step])=>{
      // Only validated research references may become links. The manifest never
      // supplies a URL; every reference stays in this refresh's output store.
      const name=manifestation.research[key];
      return name?[{step,name,url:outputURL(name,base)}]:[];
    });
  }
  function caseFigures(manifestation, base) {
    if(!manifestation?.matched)return [];
    return definition.panels.flatMap(panel=>{
      const item=manifestation.panels[panel.id];
      if(!item?.available)return [];
      const record=item.panel;
      return [{id:panel.id,title:panel.title,subtitle:panel.subtitle,kind:record.kind,
        figure:record.figure,figureUrl:outputURL(record.figure,base)+'?preview=true',
        sourceFile:record.source_file,sourceUrl:outputURL(record.source_file,base),source:record.source}];
    });
  }
  function casePrompt(task) {
    return `For Water4Energy-TVA-agent-loop, inspect the fixed case 16–22 April 2019 issued 15 April. ${task} Read actual files and cite sources. Do not submit jobs, execute training commands, change settings, or invent scores or figures. If a skill or artifact is missing, report it.`;
  }
  function prepare(task, title) {options.preparePrompt(casePrompt(task),title);}
  function renderReadiness() {
    const current=capabilities||context;
    const skills=skillReadiness(current?.skills,definition.project);
    const knowledge=current?.knowledge,coverage=knowledgeCoverage(knowledge,definition.sources,definition.project);
    const correctProject=current?.project===definition.project;
    const connected=correctProject && current?.status?.project_found;
    const kbKnown=coverage.known;
    if($('#demo-readiness'))$('#demo-readiness').innerHTML=`<article class="demo-readiness-card"><span class="eyebrow">VISTA PROJECT</span><h3>${connected?'Connected':correctProject?'Awaiting project':'Choose demo project'}</h3><p>${escapeHTML(correctProject?(current?.status?.detail || definition.project):`Selected: ${current?.project || 'not connected'}`)}</p><small>${escapeHTML(definition.project)}</small></article><article class="demo-readiness-card"><span class="eyebrow">REQUIRED SKILLS</span><h3>${skills.known?skills.loaded+' / 8 loaded':'Not checked'}</h3><p>Eight core file-reading skills. Dam readout is optional.</p><small>Loaded status is not an execution result.</small></article><article class="demo-readiness-card"><span class="eyebrow">KNOWLEDGE BASE</span><h3>${kbKnown?`${knowledge.ready_count ?? '—'} / ${knowledge.count} indexes ready`:'Not checked'}</h3><p>${coverage.known?`${coverage.listed} / 6 lead sources listed`:'Lead-source coverage is unverified.'}</p><small>Index readiness and required-source coverage are checked separately.</small></article>`;
    if($('#required-skills'))$('#required-skills').innerHTML=definition.requiredSkills.map((skill,i)=>`<div class="demo-skill-row"><div><strong>${escapeHTML(skill.id)}</strong><p>${escapeHTML(skill.description)}</p></div><span class="demo-badge ${skills.required[i].state}">${escapeHTML(skills.required[i].state==='loaded'?'Loaded':skills.required[i].state==='missing'?'Missing':'Unknown')}</span></div>`).join('')+`<div class="demo-skill-row demo-optional-skill"><div><strong>dam.readout</strong><p>Optional; excluded from the eight core skills.</p></div><span class="demo-badge">${escapeHTML(skills.optional==='loaded'?'Loaded · optional':skills.optional==='missing'?'Not loaded · optional':'Unknown · optional')}</span></div>`;
    if($('#demo-sources'))$('#demo-sources').innerHTML=`<p class="demo-source-note">${escapeHTML(knowledge?.detail || 'Connect the demo project to inspect its knowledge-base indexing status.')} Source links below are project references; a link alone does not mean it is indexed.</p><ul class="demo-source-list">${coverage.rows.map(({source,state})=>`<li><a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title)} ↗</a><span class="demo-badge">${escapeHTML(state==='listed-ready-index'?'Listed · index ready':state==='listed'?'Listed · index not ready':state==='not-listed'?'Not confirmed in index':'Coverage unknown')}</span></li>`).join('')}</ul>`;
  }
  function renderEvidence(message='') {
    if(!$('#case-evidence'))return;
    const error=evidence?.errors?.length?evidence.errors.join(' '):message;
    $('#case-evidence').innerHTML=`<div class="demo-evidence-note"><span class="demo-badge">${evidence?.matched?'Case metadata matched':'Awaiting case files'}</span><p>${escapeHTML(error || (evidence?.matched?'Saved source files for this case.':'Ask lab.realize and downscale.scorecard to collect their existing source JSON and figures. No scientific result is bundled into the interface.'))}</p><button class="text-button" id="demo-evidence-prepare">Prepare file collection ↗</button><button class="text-button" id="demo-contract-open">Evidence contract ↗</button></div><div class="demo-evidence-grid">${definition.panels.map(panel=>{
      const item=evidence?.panels?.[panel.id],available=item?.available,record=item?.panel;
      return `<article class="demo-evidence-card ${available?'available':'pending'}"><div class="demo-evidence-heading"><span class="eyebrow">${escapeHTML(panel.id==='runoff'?'OBSERVATION':panel.id==='downscale'?'FROZEN COMPARISON':'FROZEN PREDICTION')}</span><h3>${escapeHTML(panel.title)}</h3><p>${escapeHTML(panel.subtitle)}</p></div>${available?`<button class="demo-evidence-figure" data-demo-figure="${escapeHTML(panel.id)}" aria-label="Preview ${escapeHTML(panel.title)} case figure"><img src="${escapeHTML(outputURL(record.figure))}?preview=true" alt="${escapeHTML(panel.title)} · saved figure for 16–22 April 2019" loading="lazy"></button><div class="demo-evidence-meta"><span class="demo-badge">Case-matched file</span><p>${escapeHTML(record.source)}</p><a href="${escapeHTML(outputURL(record.source_file))}" download>Source JSON ↧</a><a href="${escapeHTML(outputURL(record.figure))}" download>Original figure ↧</a></div>`:`<div class="demo-evidence-empty"><strong>Awaiting source-backed figure</strong><p>${escapeHTML((evidence?.matched?item?.errors?.join(' '):'No figure associated with this case yet.'))}</p></div>`}${panel.note?`<p class="demo-panel-note">${escapeHTML(panel.note)}</p>`:''}</article>`;
    }).join('')}</div>`;
    $('#demo-evidence-prepare').addEventListener('click',()=>prepare(manifestInstructions(),'Collect the case files'));
    $('#demo-contract-open').addEventListener('click',showContract);
    $('#case-evidence').querySelectorAll('.demo-evidence-figure img').forEach(image=>image.addEventListener('error',()=>{image.closest('button').textContent='Preview unavailable · download the original figure below.';}));
    $('#case-evidence').querySelectorAll('[data-demo-figure]').forEach(button=>button.addEventListener('click',()=>{
      const id=button.dataset.demoFigure,panel=evidence.panels[id].panel,title=definition.panels.find(item=>item.id===id).title;
      options.showDetails(title+' · fixed case',`<figure class="results-library-figure"><img src="${escapeHTML(outputURL(panel.figure))}?preview=true" alt="${escapeHTML(title)}"><figcaption>${escapeHTML(panel.source)}</figcaption></figure><p>16–22 April 2019 · issued 15 April. Metadata is supplied by the case source file.</p><p><a href="${escapeHTML(outputURL(panel.source_file))}" download>Download source JSON ↗</a></p>`);
    }));
  }
  function manifestInstructions() {
    return `Use lab.realize and downscale.scorecard to collect existing saved figures and backing JSON for the fixed case. Write ${MANIFEST_NAME} in project outputs with schema_version:1, case:{start:"2019-04-16",end:"2019-04-22",issued:"2019-04-15"}, and panels containing temperature, precipitation, runoff and downscale. Each panel requires figure, source_file (JSON) and source description. Temperature/precipitation require kind:"frozen_prediction",model:"det_v2_soil_k9". Runoff requires kind:"observation",dataset:"ERA5",variable:"sro",forecast_available:false. Downscale requires kind:"frozen_comparison",trial:"Trial 0",scored:"2026-09-07",input_resolution_deg:1,output_resolution_deg:0.25,date within this case week. Files must actually exist in this project's outputs. Partial manifests must leave missing panels empty and report them; never substitute unrelated files. Use display_file for the saved source and figures. Do not run training or invent missing data.`;
  }
  function showContract() {
    options.showDetails('Case evidence contract',`<p>The adapter associates figures only through <code>${MANIFEST_NAME}</code> in the selected project's outputs. It checks declared case metadata and file presence; it does not independently re-score or verify the science. This is the Workbench adapter contract; it does not install or implement a science skill.</p><p>Every panel names an existing raster figure, a backing source JSON and its scientific source. Case dates must match exactly. Runoff stays an ERA5 observation, with HEADWATER forecast unavailable. Trial 0 stays a frozen 1° to 0.25° comparison.</p><p><a href="/data/demo-evidence.schema.json" download>Download JSON schema ↧</a></p><pre>${escapeHTML(manifestInstructions())}</pre><p>An optional <code>dam.source_file</code> points to a separate readout JSON with the same case, selected reservoir, agreed rule, a fill/hold decision and <code>realization_source_file</code>. The interface never computes an operation.</p>`);
  }
  function renderQuestions() {
    if(!$('#demo-questions'))return;
    $('#demo-questions').innerHTML=definition.questions.map((item,i)=>`<button class="demo-question" data-demo-question="${i}"><span>0${i+1}</span><strong>${escapeHTML(item.question)}</strong><span aria-hidden="true">↗</span></button>`).join('');
    $('#demo-questions').querySelectorAll('[data-demo-question]').forEach(button=>button.addEventListener('click',()=>{const item=definition.questions[Number(button.dataset.demoQuestion)];prepare(item.question+' Answer from the named skills, ledger and saved case files. If this asks about the dam panel, explain its optional scope without selecting or calculating an operation.','Cold-open question');}));
  }
  function buildDam() {
    if(!$('#dam-panel'))return;
    $('#dam-panel').innerHTML='<div class="demo-dam-heading"><div><span class="eyebrow">OPTIONAL · LAST PANEL</span><h3>Reservoir readout</h3><p>A saved fill/hold sentence for one agreed demonstration rule.</p></div><label class="demo-dam-toggle"><input id="demo-dam-toggle" type="checkbox"> Include dam panel</label></div><div class="demo-dam-body" hidden><div class="demo-dam-controls"><div><label for="demo-dam-reservoir">Reservoir</label><select id="demo-dam-reservoir"><option value="">Choose a reservoir…</option><option>Normandy</option><option>Norris</option></select></div><div><label for="demo-dam-rule">Agreed plain-language rule</label><textarea id="demo-dam-rule" rows="3" placeholder="Enter the rule agreed for this demonstration. No rule is assumed."></textarea></div></div><button class="secondary-button" id="demo-dam-prepare" disabled>Prepare dam.readout request ↗</button><div id="demo-dam-readout" class="demo-dam-readout" aria-live="polite"></div><p class="demo-panel-note">Reads this case’s realization JSON. No RiverWare, release instruction or plant-MW calculation.</p></div>';
    $('#demo-dam-toggle').addEventListener('change',event=>{damState.enabled=event.target.checked;$('.demo-dam-body').hidden=!damState.enabled;renderDamResult();});
    $('#demo-dam-reservoir').addEventListener('change',event=>{damState.reservoir=event.target.value;renderDamResult();});
    $('#demo-dam-rule').addEventListener('input',event=>{damState.rule=event.target.value;renderDamResult();});
    $('#demo-dam-prepare').addEventListener('click',()=>{
      if(!damState.enabled || !['Normandy','Norris'].includes(damState.reservoir) || !normalizedRule(damState.rule))return;
      prepare(`Only for the optional final dam panel, use dam.readout for ${damState.reservoir}. The agreed plain-language rule is: ${damState.rule.trim()} Read the actual same-week realization JSON and apply only this agreed demonstration rule. If the skill, values or rule are insufficient, state that no readout is available. Save a readout JSON with case dates, reservoir:"${damState.reservoir}", exact rule text, decision:"fill" or "hold", and realization_source_file referring to the case source JSON. Add dam:{source_file:"the actual saved readout filename"} to ${MANIFEST_NAME}. Display the files. Do not use RiverWare or issue a reservoir release instruction.`,'Optional dam readout');
    });
    renderDamResult();
  }
  function renderDamResult() {
    if(!$('#demo-dam-readout'))return;
    const canPrepare=damState.enabled && ['Normandy','Norris'].includes(damState.reservoir) && Boolean(normalizedRule(damState.rule));
    $('#demo-dam-prepare').disabled=!canPrepare;
    const result=validateDamReadout(damState.source,damState,evidence,definition.case);
    $('#demo-dam-readout').innerHTML=result.available?`<span class="demo-badge">Saved demonstration readout</span><h3>${escapeHTML(result.reservoir)} · ${result.decision==='fill'?'Fill':'Hold'}</h3><p>${escapeHTML(result.rule)}</p><a href="${escapeHTML(outputURL(damState.sourceName))}" download>Readout JSON ↧</a><a href="${escapeHTML(outputURL(result.source))}" download>Realization source ↧</a>`:`<p>${escapeHTML(result.reason)}</p>${canPrepare?'<small>Prepare a request, review it in the agent composer, then send. No decision is generated by this control.</small>':''}`;
  }
  function reset() {
    ++revision;evidence=null;damState.source=null;damState.sourceName=null;
    if(definition){renderEvidence();renderDamResult();}
  }
  function init(configuration) {
    options=configuration;definition=configuration.caseDefinition;
    if(!definition || !matchesCase(definition.case) || definition.project!=='Water4Energy-TVA-agent-loop')throw new Error('The fixed TVA demo definition is invalid.');
    renderEvidence();renderQuestions();buildDam();renderReadiness();
  }
  function updateCapabilities(next) {
    if(!options||!definition)return null;
    const matchingProject=next?.project===definition.project;
    capabilities={project:next?.project,status:next?.status,skills:matchingProject?next?.skills:null,knowledge:matchingProject?next?.knowledge:null,backend:next?.backend};
    renderReadiness();
    return skillReadiness(capabilities.skills,definition.project);
  }
  async function refresh(next) {
    if(!options)return null;
    const id=++revision,outputBase=options.projectUrl('/outputs');
    context={...next,outputBase};evidence=null;damState.source=null;damState.sourceName=null;
    updateCapabilities(next);renderDamResult();
    if(next.project!==definition.project || !next.status?.project_found) {
      renderEvidence(next.project!==definition.project?'Select Water4Energy-TVA-agent-loop in Connection settings to inspect this demo’s case files.':'Connect the named VISTA project to load its case evidence.');
      return {matched:false,reason:'project-unavailable',researchLinks:[],caseFigures:[]};
    }
    renderEvidence('Reading the selected project’s saved case files…');
    try {
      const files=await options.api(outputBase);
      if(id!==revision)return null;
      if(!Array.isArray(files))throw new Error('The project output listing is unavailable.');
      const manifestFile=files.find(file=>file && file.name===MANIFEST_NAME);
      if(!manifestFile) {renderEvidence(`The project does not yet contain ${MANIFEST_NAME}. Prepare a file-collection request to connect existing case artifacts.`);return {matched:false,reason:'manifest-missing',researchLinks:[],caseFigures:[]};}
      if(Number.isFinite(manifestFile.size) && manifestFile.size>262144)throw new Error('The case manifest exceeds the 256 KB metadata limit.');
      const manifest=await options.api(outputURL(MANIFEST_NAME,outputBase));
      if(id!==revision)return null;
      evidence=validateManifest(manifest,files,definition.case);
      const damFile=evidence.matched && evidence.data?.dam?.source_file;
      if(validPath(damFile) && /\.json$/i.test(damFile) && evidence.names.has(damFile)) {
        const metadata=files.find(file=>file.name===damFile);
        if(!Number.isFinite(metadata.size) || metadata.size<=262144) {
          try {const source=await options.api(outputURL(damFile,outputBase));if(id!==revision)return null;damState.source=source;damState.sourceName=damFile;}catch {if(id!==revision)return null;}
        }
      }
      renderEvidence();renderDamResult();
      return {matched:evidence.matched,available:Object.values(evidence.panels).filter(panel=>panel.available).length,researchLinks:researchLinks(evidence,outputBase),caseFigures:caseFigures(evidence,outputBase)};
    } catch(error) {
      if(id!==revision)return null;
      evidence=null;damState.source=null;damState.sourceName=null;renderDamResult();renderEvidence(error?.message || 'Case files are unavailable. Refresh after checking VISTA.');
      return {matched:false,reason:'read-failed',researchLinks:[],caseFigures:[]};
    }
  }
  const api={init,refresh,reset,updateCapabilities,validPath,matchesCase,dateInCase,validateManifest,skillReadiness,knowledgeCoverage,validateDamReadout,sourceMatches,manifestInstructions};
  global.TVAHypothesisDemo=api;
  if(typeof module!=='undefined' && module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
