// Optional developer checks; Node is not required to run the application.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8').split('// Bind once.')[0];
const context = vm.createContext({console});
const projectUI = fs.readFileSync(path.join(__dirname, '../public/project-ui.js'), 'utf8');
vm.runInContext(projectUI + '\n' + source + '\nglobalThis.parse = {parseCSV, parsePredictionCSV, format};', context);

test('quoted CSV cells and CRLF preserve names and numeric fields', () => {
  const rows=context.parse.parseCSV('site_id,start,predicted_volume_m3,note\r\n"ELF13",2010-01-04,1000000,"a, b"\r\n');
  assert.equal(rows[0].note,'a, b');
  assert.equal(rows[0].predicted_volume_m3,'1000000');
});
test('plotting requires an explicit volume unit contract', () => {
  assert.equal(context.parse.parsePredictionCSV('site_id,date,prediction\nELF13,2010-01-04,10\n','unqualified.csv'),null);
});
test('volumes convert exactly and missing observations remain missing', () => {
  const data=context.parse.parsePredictionCSV('basin_id,start,predicted_volume_m3,observed_volume_m3\nELF13,2010-01-04,7000000,\nELF13,2010-01-11,0,1000000\n','predictions.csv');
  assert.equal(data.sites[0].series[0].predicted,7);
  assert.equal(data.sites[0].series[0].observed,null);
  assert.equal(data.sites[0].series[1].predicted,0);
  assert.equal(data.sites[0].series[1].observed,1);
});
test('impossible dates and explicitly nonweekly rows are excluded', () => {
  const csv='site_id,start,days,predicted_volume_m3\nELF13,2010-02-30,7,100\nELF13,2010-03-01,6,200\nELF13,2010-03-08,7,3000000\n';
  const data=context.parse.parsePredictionCSV(csv,'weekly.csv');
  assert.equal(data.sites[0].series.length,1);
  assert.equal(data.sites[0].series[0].date,'2010-03-08');
});
test('missing predictions stay null rather than becoming zero', () => {
  const data=context.parse.parsePredictionCSV('basin_id,start,predicted_volume_m3\nELF13,2010-01-04,NaN\nELF13,2010-01-18,\n','incomplete.csv');
  assert.equal(data.sites[0].series[0].predicted,null);
  assert.equal(data.sites[0].series[1].predicted,null);
});
test('missing totals cannot be exported as zero volume', () => {
  assert.equal(context.parse.format(null),'—');
  assert.equal(context.parse.format(undefined),'—');
  assert.equal(context.parse.format(''),'—');
  assert.equal(context.parse.format(0),'0.0');
});
test('starter prompts prepare the fixed case without sending or adding background locations', () => {
  const prompt={id:'ledger',livePrompt:'Read the ledger for 16–22 April 2019, issued 15 April 2019.'};
  const field={value:'',focus(){this.focused=true;}};
  const form={scrollIntoView(){}};
  const controls={'#prompt':field,'#chat-form':form};
  context.document={querySelector:selector=>controls[selector],querySelectorAll:()=>[]};
  context.promptFixture=prompt;
  vm.runInContext("state.busy=false; state.view='history'; state.activeContext='tva'; state.prompts=[promptFixture]; state.network={sites:[{id:'WOLF_CREEK',name:'Wolf Creek'}]}; state.focusSiteId='WOLF_CREEK'; globalThis.sent=0; sendLive=()=>{sent++;}; switchView=view=>{globalThis.openedView=view;}; toast=()=>{}; usePrompt('ledger');",context);
  assert.equal(context.openedView,'workspace');
  assert.equal(context.sent,0);
  assert.equal(field.focused,true);
  assert.equal(field.value,prompt.livePrompt);
  assert.doesNotMatch(field.value,/Wolf Creek/);
  const before=field.value;
  vm.runInContext("state.activeContext='headwater'; usePrompt('ledger');",context);
  assert.equal(field.value,before);
  vm.runInContext("state.activeContext='tva';",context);
  vm.runInContext("state.busy=true; usePrompt('ledger');",context);
  assert.equal(field.value,before);
});
test('demo catalog fixes issue/valid dates and keeps eight core skills separate from the dam', () => {
  const demo=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/demo-case.json')));
  const prompts=JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/prompts.json'))).prompts;
  assert.deepEqual(demo.case,{start:'2019-04-16',end:'2019-04-22',issued:'2019-04-15'});
  assert.equal(demo.project,'Water4Energy-TVA-agent-loop');
  assert.equal(demo.requiredSkills.length,8);
  assert.equal(demo.optionalSkill.id,'dam.readout');
  assert.ok(demo.requiredSkills.every(skill=>skill.id!=='dam.readout'));
  assert.equal(new Set(prompts.map(prompt=>prompt.id)).size,prompts.length);
  assert.ok(prompts.every(prompt=>prompt.livePrompt.includes('2019') && !Object.hasOwn(prompt,'recordedAnswer')));
  assert.ok(prompts.find(prompt=>prompt.id==='runoff').livePrompt.includes('ERA5'));
  assert.ok(prompts.find(prompt=>prompt.id==='downscale').livePrompt.includes('bilinear'));
});
