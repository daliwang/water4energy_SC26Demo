const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const start=source.indexOf('function refreshHeadwaterEvidence(');
const end=source.indexOf('\nasync function api(',start);
function fixture(){
 const container={},calls=[];
 const state={activeContext:'headwater',headwaterEvidenceTopic:'overview'};
 const context=vm.createContext({state,isAprilContext:()=>state.activeContext==='tva',$:()=>container,
  renderProjectFigures:()=>{},Water4EnergyWorkflow:{evidenceTopicForRequest:text=>text==='Frontier question'?'data':'overview',renderContextEvidence:(target,options)=>calls.push({target,topic:options.topic})}});
 vm.runInContext(source.slice(start,end),context);
 return {state,context,calls,container};
}
test('HEADWATER questions select their saved evidence topic without making a backend request',()=>{
 const f=fixture();f.context.refreshHeadwaterEvidence('Frontier question');
 assert.equal(f.state.headwaterEvidenceTopic,'data');assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].target,f.container);assert.equal(f.calls[0].topic,'data');
 f.context.refreshHeadwaterEvidence();assert.equal(f.calls[1].topic,'data');
 f.context.refreshHeadwaterEvidence('an unrelated question');assert.equal(f.calls[2].topic,'overview');
});
test('the April context cannot overwrite HEADWATER topic state or its evidence view',()=>{
 const f=fixture();f.state.activeContext='tva';f.state.headwaterEvidenceTopic='board';
 f.context.refreshHeadwaterEvidence('Frontier question');
 assert.equal(f.state.headwaterEvidenceTopic,'board');assert.equal(f.calls.length,0);
});
