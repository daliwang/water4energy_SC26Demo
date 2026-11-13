// Use the app's real viewer with a small DOM boundary, without a browser or agent.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').split('// Bind once.')[0];
class Element{
  constructor(){this.children=[];this.parentElement=null;this.dataset={};this.hidden=false;this.writes=0;this._html='';this.buttons=[];}
  set innerHTML(value){this._html=value;this.writes++;this.image={html:value.match(/<img[^>]*>/)?.[0]};this.buttons=Array.from(value.matchAll(/data-project-figure="(\d+)"/g),m=>this.control({projectFigure:m[1]}));this.resume=value.includes('data-project-figure-resume')?this.control({}):null;}
  get innerHTML(){return this._html;}
  control(dataset){return {dataset,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;},click(){this.listeners.click?.();}};}
  replaceChildren(){this._html='';this.image=null;this.buttons=[];this.resume=null;this.writes++;}
  prepend(child){if(child.parentElement)child.parentElement.children.splice(child.parentElement.children.indexOf(child),1);this.children.unshift(child);child.parentElement=this;}
  querySelectorAll(selector){return selector==='[data-project-figure]'?this.buttons:[];}
  querySelector(selector){return selector==='[data-project-figure-resume]'?this.resume:null;}
}
function fixture(){
  const mount=new Element(),hosts=Object.fromEntries(['#view-development','#view-introduction','#development-evidence','#lab24-evidence'].map(selector=>[selector,new Element()]));
  const context=vm.createContext({document:{querySelector:selector=>selector==='#project-live-evidence'?mount:hosts[selector]},TVALiveLabSync:require('../public/live-lab-sync.js')});
  vm.runInContext('globalThis.window=globalThis;\n'+source+'\nglobalThis.app={state,renderProjectFigures,clearLiveConversation,fileUrl,liveContext};',context);
  const app=context.app;app.state.config={project:'Water4Energy-TVA-agent-loop',backend_url:'http://127.0.0.1:8001'};app.state.sessionId='current-conversation';
  return {app,mount,hosts,context};
}
function figure(app,name,display='display-1'){return {name,url:app.fileUrl('outputs',name)+'?preview=true',downloadUrl:app.fileUrl('outputs',name),displayId:display};}
test('the project viewer accepts current project output images and rejects other projects, stores, unsafe paths and active formats',()=>{
  const {app,mount}=fixture();
  const valid=figure(app,'nested/result.png');
  const invalid=[
    {...figure(app,'wrong-project.png'),url:'/api/vista/projects/Other/outputs/wrong-project.png?preview=true'},
    {...figure(app,'upload.png'),url:app.fileUrl('uploads','upload.png')+'?preview=true',downloadUrl:app.fileUrl('uploads','upload.png')},
    figure(app,'../escape.png'),figure(app,'plot.svg'),figure(app,'report.html'),
    {...figure(app,'changed.png'),status:'changed'},
    {...figure(app,'other-store.png'),kind:'uploads'},
    {...figure(app,'external.png'),downloadUrl:'https://example.org/external.png'},
  ];
  app.state.projectFigures=invalid;app.renderProjectFigures();assert.equal(mount.hidden,true);assert.equal(mount.innerHTML,'');
  app.state.projectFigures=[...invalid,valid];app.renderProjectFigures();
  assert.equal(mount.hidden,false);assert.match(mount.innerHTML,/nested\/result.png/);assert.equal(mount.buttons.length,1);
  assert.doesNotMatch(mount.innerHTML,/wrong-project|upload.png|escape|plot.svg|report.html|changed.png|other-store|external.png/);
});
test('an unchanged poll preserves the image node while a new actual display updates it',()=>{
  const {app,mount}=fixture();app.state.projectFigures=[figure(app,'result.png')];app.renderProjectFigures();
  const image=mount.image,writes=mount.writes;
  app.state.projectFigures=[figure(app,'result.png')];app.renderProjectFigures();
  assert.equal(mount.image,image);assert.equal(mount.writes,writes);
  app.state.projectFigures=[figure(app,'result.png','later-display')];app.renderProjectFigures();
  assert.notEqual(mount.image,image);assert.equal(mount.writes,writes+1);
});
test('manual inspection holds its figure when new displays arrive; Resume follows the newest actual display',()=>{
  const {app,mount}=fixture();app.state.projectFigures=[figure(app,'first.png'),figure(app,'second.png')];app.renderProjectFigures();
  assert.match(mount.image.html,/second.png/);
  mount.buttons[0].click();assert.equal(app.state.projectFigureSelection,'first.png');assert.match(mount.image.html,/first.png/);
  app.state.projectFigures.push(figure(app,'third.png'));app.renderProjectFigures();
  assert.match(mount.image.html,/first.png/);assert.match(mount.innerHTML,/Reviewing your selection/);
  mount.resume.click();assert.equal(app.state.projectFigureSelection,null);assert.match(mount.image.html,/third.png/);
  assert.match(mount.innerHTML,/Following the latest actual display/);
});
test('figures stay in the selected right-hand workspace and clear when the conversation scope is reset or the project changes',()=>{
  const {app,mount,hosts}=fixture();app.state.projectFigures=[figure(app,'result.png')];
  for(const [view,activeContext,host] of [['development','headwater','#view-development'],['introduction','lab24','#view-introduction'],['workspace','lab24','#lab24-evidence'],['workspace','headwater','#development-evidence']]){
    app.state.view=view;app.state.activeContext=activeContext;app.renderProjectFigures();assert.equal(mount.parentElement,hosts[host]);
  }
  app.state.projectFigureSelection='result.png';app.clearLiveConversation();
  assert.equal(mount.hidden,true);assert.equal(mount.innerHTML,'');assert.equal(app.state.projectFigureSelection,null);assert.equal(app.state.projectFigures.length,0);
  app.state.projectFigures=[figure(app,'old-project.png')];app.state.config.project='Other-project';app.renderProjectFigures();
  assert.equal(mount.hidden,true);assert.equal(mount.innerHTML,'');
});
test('only known supplied figures receive their documented scope; October comparisons cannot imply the residual-run result',()=>{
  const {app,mount}=fixture();app.state.activeContext='lab24';
  for(const name of ['w4e-v0150-tva-t2m-2019-reslim.png','w4e-v0150-tva-precip-2019-reslim.png','w4e-v0150-valley-temperature-2019.png']){
    app.state.projectFigures=[figure(app,name)];app.renderProjectFigures();
    assert.match(mount.innerHTML,/These maps compare earlier models; the residual-test result is reported separately/);
    assert.match(mount.innerHTML,/Supplied figure provenance/);
    assert.doesNotMatch(mount.innerHTML,/0\.955/);
  }
  for(const [name,units] of [['w4e-v0150-april-2019-tmax-refine.png','°C'],['w4e-v0150-april-2019-prcp-refine.png','mm/day']]){
    app.state.projectFigures=[figure(app,name)];app.renderProjectFigures();
    assert.match(mount.innerHTML,/Whole April 2019 · 30 days/);
    assert.ok(mount.innerHTML.includes(units));assert.match(mount.innerHTML,/monthly mean and daily 95th percentile · about 4 km/);
    assert.match(mount.innerHTML,/separate from the 16–22 April weekly Trial 0 comparison/);
  }
  app.state.projectFigures=[figure(app,'future-reslim-result.png')];app.renderProjectFigures();
  assert.match(mount.innerHTML,/has not verified its scientific source or scope/);
  assert.doesNotMatch(mount.innerHTML,/These maps compare earlier models|Whole April 2019|Supplied figure provenance/);
});
