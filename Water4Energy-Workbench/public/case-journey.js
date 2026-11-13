/* Teaching and question preparation only. Execution still belongs to explicit Send. */
(function(global){
  'use strict';
  const HEADER='Case: 16–22 April 2019, issued 15 April 2019, in Water4Energy-TVA-agent-loop.';
  const VIEWS=new Set(['development','introduction','network','workspace']);
  const QUESTIONS=Object.freeze([
    {id:'ledger',question:'What did the ledger already establish for 16–22 April 2019?',hint:'Start with scored, closed and still-open work.'},
    {id:'realization',question:'What do the saved April temperature and precipitation figures show?',hint:'Read the existing HEADWATER results and their sources.'},
    {id:'downscale',question:'How does frozen Trial 0 compare with bilinear for this April case?',hint:'Inspect the existing high-resolution comparison.'},
    {id:'runoff',question:'Why is the April runoff panel an observation rather than a forecast?',hint:'Distinguish ERA5 runoff from an unavailable prediction.'},
    {id:'design',question:'Which open April gap still needs a reviewed test?',hint:'Separate a proposed idea from recorded review and approval.'},
    {id:'commands',question:'Which existing commands would a person need to review before any future run?',hint:'Display command references without executing them.'}
  ].map(Object.freeze));
  const ANSWER_PROFILES=Object.freeze({
    ledger:{reader:'lab.ledger',question:'ledger'},
    realization:{reader:'lab.realize',question:'weather'},
    downscale:{reader:'downscale.scorecard',question:'downscale'},
    runoff:{reader:'lab.realize',question:'runoff'},
    design:{reader:'lab.design',question:'design'},
    commands:{reader:'lab.show_command',question:'commands'}
  });
  const PROJECT_LINKS={ledger:'The lab starts from what was already scored.',proposer:'The brief names one change for a reviewed experiment.',critic:'Check for a closed or blocked experiment without a meaningful change.',referee:'Inspect the review and identify evidence that is still missing.',human:'A person picks the experiment and sets the training flag.',evidence:'The score returns to the ledger, and the next brief is written from that ledger.'};
  const PROJECT_COPY={evidence:'Inspect the saved project score and its sources. Return the result to the ledger before writing the next brief.'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options={},selected='ledger',bound=false;
  function questionRequest(id,settings=options){
    const question=QUESTIONS.find(q=>q.id===id),guide=settings.guide||global.TVAHypothesisGuide;
    if(!question||!guide?.matchesCase(settings.caseDefinition))return null;
    const prompt=(Array.isArray(settings.prompts)?settings.prompts:[]).find(p=>p?.id===id)?.livePrompt;
    if(typeof prompt!=='string'||!prompt.startsWith(HEADER)||!prompt.includes('Do not submit jobs'))return null;
    const profile=ANSWER_PROFILES[id];
    const contract='Saved-evidence answer\n'
      +'Use only the '+profile.reader+' saved-evidence reader with the '+profile.question+' question profile (--question '+profile.question+'). '
      +'The case paragraph above supplies background and safety constraints; its broader focus is not a request for supplementary readers. '
      +'Quote the returned verified_answer exactly, labelled “Saved-evidence answer”. Do not paraphrase or add summaries, tables, explanations or claims about other gaps. '
      +'Call display_file for every returned display_paths entry, then cite source_paths separately. Do not substitute Markdown image text for display calls. '
      +'Stop after that verified readout and its citations. If the reader or a required file is unavailable, report what is missing and stop without a substitute answer.';
    return question.question+'\n\n'+prompt+'\n\n'+contract;
  }
  function welcomeHTML(){
    return `<div class="welcome"><h3>Start with the April evidence</h3><p>Read what was already tested, then inspect the saved figures. Choose a question to put an editable request in the message box.</p><div class="welcome-questions">${QUESTIONS.slice(0,3).map(q=>`<button type="button" data-case-question="${q.id}">${esc(q.question)}<span aria-hidden="true">↗</span></button>`).join('')}</div><p class="welcome-note">Review the request, then Send. Cited files and figures appear on the right.</p><button type="button" class="text-button case-method-link" data-journey-nav="introduction">Open Hypothesis lab ↗</button></div>`;
  }
  function workflowHTML(steps){
    return `<div class="hypothesis-guide-map intro-workflow-map"><svg class="hypothesis-guide-connectors" viewBox="0 0 336 210" preserveAspectRatio="none" aria-hidden="true" focusable="false"><defs><marker id="intro-workflow-arrow" viewBox="0 0 6 6" refX="5.5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6Z"/></marker></defs><g marker-end="url(#intro-workflow-arrow)"><path d="M148 32H186"/><path d="M252 58V72"/><path d="M188 98H150"/><path d="M84 124V138"/><path d="M148 164H186"/><path class="hypothesis-guide-return" d="M252 190V204H7V32H18"/></g></svg><div class="hypothesis-guide-nodes" role="group" aria-label="Explore the hypothesis method">${steps.map((s,i)=>`<button type="button" class="hypothesis-guide-node hypothesis-guide-node-${s.id}" data-intro-step="${s.id}" aria-pressed="${s.id===selected}" aria-controls="intro-step-detail" aria-label="${esc(s.title+' — '+s.role)}"><span class="hypothesis-guide-node-number" aria-hidden="true">${i+1}</span><span class="hypothesis-guide-node-copy"><strong>${esc(s.label)}</strong><small>${esc(s.role)}</small></span></button>`).join('')}</div><span class="hypothesis-guide-return-label">Findings return to the ledger</span></div>`;
  }
  function renderStep(){
    if(global.Water4EnergyLab24?.renderMethod){global.Water4EnergyLab24.renderMethod();return;}
    const guide=options.guide,step=guide?.steps.find(s=>s.id===selected),mount=global.document?.querySelector('#intro-step-detail');
    if(!step||!mount)return;
    global.document.querySelectorAll('[data-intro-step]').forEach(button=>{
      const active=button.dataset.introStep===selected;
      button.setAttribute('aria-pressed',String(active));button.classList.toggle('selected',active);
    });
    const request=options.methodRequest?options.methodRequest(selected):guide.requestFor(selected,options);
    const ready=typeof (options.prepareProjectPrompt||options.preparePrompt)==='function'&&Boolean(request);
    mount.innerHTML=`<h3>${esc(step.title)}</h3><p>${esc(PROJECT_COPY[selected]||step.description)}</p><p class="intro-case-link">${esc(PROJECT_LINKS[selected])}</p><p class="intro-question">“${esc(options.methodRequest?request?.split('\n')[0]||step.title:step.question)}”</p><button type="button" class="text-button" data-intro-prepare${ready?'':' disabled'}>Try this question in Case Lab ↗</button>`;
  }
  function selectStep(id){
    if(global.Water4EnergyLab24?.selectStep)return global.Water4EnergyLab24.selectStep(id);
    if(!options.guide?.steps.some(s=>s.id===id))return false;
    selected=id;renderStep();return true;
  }
  function setView(view){
    global.document?.querySelectorAll('[data-journey-nav]').forEach(button=>{
      if(button.dataset.journeyNav===view)button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
  }
  function dispatch(event){
    const target=event.target?.closest?.('[data-journey-nav],[data-intro-step],[data-intro-prepare],[data-case-question],[data-open-tva-case]');
    if(!target||target.disabled)return;
    if(target.hasAttribute('data-open-tva-case')){options.openCase?.(target.dataset.openTvaCase||'workspace');return;}
    if(target.dataset.journeyNav){if(VIEWS.has(target.dataset.journeyNav))options.navigate?.(target.dataset.journeyNav);return;}
    if(target.dataset.introStep){selectStep(target.dataset.introStep);return;}
    if(target.hasAttribute('data-intro-prepare')){if(global.Water4EnergyLab24){const request=global.Water4EnergyLab24.questionRequest(global.Water4EnergyLab24.selectedStep());if(request)options.prepareLabPrompt?.(request);return;}const request=options.methodRequest?options.methodRequest(selected):options.guide?.requestFor(selected,options);if(request)(options.prepareProjectPrompt||options.preparePrompt)?.(request);return;}
    const request=questionRequest(target.dataset.caseQuestion);if(request)options.preparePrompt?.(request);
  }
  function questionMenuHTML(){return `<details><summary>Questions for this case</summary><div class="case-question-list">${QUESTIONS.map(q=>`<button type="button" data-case-question="${q.id}"${questionRequest(q.id)?'':' disabled'}><strong>${esc(q.question)}</strong><span>${esc(q.hint)}</span></button>`).join('')}</div></details>`;}
  function init(settings={}){
    options=settings;selected='ledger';
    const doc=global.document,mount=doc?.querySelector('#intro-workflow');
    if(!mount||!settings.guide?.steps)return false;
    if(global.Water4EnergyLab24)global.Water4EnergyLab24.init({prepareQuestion:settings.prepareLabPrompt,navigate:settings.navigate});
    else {mount.innerHTML=workflowHTML(settings.guide.steps);renderStep();}
    const questions=doc.querySelector('#case-question-controls');if(questions)questions.innerHTML=questionMenuHTML();
    if(!bound){doc.addEventListener('click',dispatch);bound=true;}
    setView('introduction');return true;
  }
  const api={init,setView,selectStep,questionRequest,welcomeHTML,questionMenuHTML,questions:QUESTIONS};
  global.TVACaseJourney=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
