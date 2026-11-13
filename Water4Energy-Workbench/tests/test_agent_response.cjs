const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {isMalformedToolResponse,MALFORMED_TOOL_MESSAGE,requestPreview}=require('../public/agent-response.js');

const observed='<|start|>assistant<|channel|>commentary to=functions.run_bash <|constrain|>c{\n  "command": "sed -n \'1,200p\' /mnt/skills/lab-ledger/SKILL.md"\n}<|call|>';

test('the provider response containing only literal tool framing is rejected when no tool ran',()=>{
  assert.equal(isMalformedToolResponse(observed),true);
  assert.equal(isMalformedToolResponse(' \n'+observed+'\n '),true);
  assert.equal(isMalformedToolResponse(observed,0),true);
});

test('actual tool calls and unknown counts prevent an unexecuted-tool classification',()=>{
  for(const count of [1,2,19,-1,null,NaN,'0'])assert.equal(isMalformedToolResponse(observed,count),false);
});

test('quoted protocol explanations and code examples are ordinary answer content',()=>{
  for(const text of [
    'The provider emitted this example: '+observed,
    '```text\n'+observed+'\n```',
    '~~~text\n'+observed+'\n~~~',
    '> '+observed,
    '`'+observed+'`',
    JSON.stringify(observed),
    "'"+observed+"'",
    '&lt;|start|&gt;assistant&lt;|channel|&gt;commentary to=functions.run_bash',
    observed+'\nThis is an explanation of the syntax, not a requested action.',
  ])assert.equal(isMalformedToolResponse(text),false,text);
});

test('scientific prose, final frames and incomplete token mentions do not look like tool calls',()=>{
  for(const text of [
    'The four-week temperature error was 0.77 degrees Celsius, compared with 0.86.',
    'The observation is 55.9 mm for the week; it is not a daily rate.',
    'Use <|start|>assistant and <|channel|> only when explaining the protocol.',
    '<|start|>assistant<|channel|>final<|message|>The result is already recorded.<|end|>',
    '<|start|>assistant<|channel|>analysis<|message|>Review the source record.<|end|>',
    '<|start|>assistant<|channel|>commentary to=functions.run_bash is a header example.',
    '<|start|>assistant<|channel|>commentary to=functions.run_bash {this is not JSON}<|call|>',
    '',null,undefined,{},
  ])assert.equal(isMalformedToolResponse(text),false,String(text));
});

test('both standard tool framing and constrained JSON framing are recognized without execution',()=>{
  const standard='<|start|>assistant to=functions.view<|channel|>commentary<|message|>{"path":"/mnt/skills/lab-ledger/SKILL.md"}<|call|>';
  const constrained='<|start|>assistant to=functions.view<|constrain|>json{"path":"/mnt/skills/lab-ledger/SKILL.md"}';
  assert.equal(isMalformedToolResponse(standard),true);
  assert.equal(isMalformedToolResponse(constrained),true);
  assert.equal(isMalformedToolResponse(observed+'\n'+standard),true);
  assert.equal(isMalformedToolResponse(standard+'\nA normal answer follows.'),false);
});

test('browser export is pure and its failure copy tells a person how to retry',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/agent-response.js'),'utf8');
  const window={};
  const context=vm.createContext({window,fetch:()=>assert.fail('helper must never access a backend')});
  vm.runInContext(source,context);
  assert.equal(typeof window.Water4EnergyAgentResponse.isMalformedToolResponse,'function');
  assert.equal(typeof window.Water4EnergyAgentResponse.requestPreview,'function');
  assert.equal(window.Water4EnergyAgentResponse.isMalformedToolResponse(observed),true);
  assert.equal(window.Water4EnergyAgentResponse.MALFORMED_TOOL_MESSAGE,MALFORMED_TOOL_MESSAGE);
  assert.match(MALFORMED_TOOL_MESSAGE,/review it.*press Send.*try again/i);
  assert.doesNotMatch(MALFORMED_TOOL_MESSAGE,/Harmony|protocol|function|auto.?retry|executed/i);
});

test('request previews leave normal prose, incomplete guards and unrelated cases untouched',()=>{
  const header='Water4Energy project — HEADWATER development.';
  for(const text of [
    'What changed?\n\nPlease explain the recorded result in plain language.',
    'What changed?\n'+header+'\nSaved-evidence answer\nQuote the source.',
    'What changed?\n\n'+header+'\nA normal follow-up question.',
    'What changed?\n\nCase: 1–7 May 2019.\nSaved-evidence answer\nQuote the source.',
    ' \n\n'+header+'\nSaved-evidence answer\nQuote the source.',
    '\n\n'+header+'\nSaved-evidence answer\nQuote the source.',
    'What changed?\n\n '+header+'\nSaved-evidence answer\nQuote the source.',
    '',null,undefined,{},
  ])assert.equal(requestPreview(text),null,String(text));
});

test('HEADWATER request previews preserve the first line and all details for an exact round trip',()=>{
  const question='What did the recorded test show?  ';
  const details='Water4Energy project — HEADWATER development. Keep the dated sources.\n\nSaved-evidence answer\nQuote verified_answer exactly.\n\n  Keep this trailing spacing.  \n';
  const original=question+'\n\n'+details;
  assert.deepEqual(requestPreview(original),{question,details});
  const result=requestPreview(original);
  assert.equal(result.question+'\n\n'+result.details,original);
});

test('April guided requests use their exact case header and retain the original safety text',()=>{
  const question='Why is the April runoff panel an observation?';
  const details='Case: 16–22 April 2019, issued 15 April 2019, in Water4Energy-TVA-agent-loop. Do not submit jobs.\n\nSaved-evidence answer\nUse the runoff profile and display every returned file.';
  assert.deepEqual(requestPreview(question+'\n\n'+details),{question,details});
  const unrelated=details.replace('16–22 April 2019','16–23 April 2019');
  assert.equal(requestPreview(question+'\n\n'+unrelated),null);
});
