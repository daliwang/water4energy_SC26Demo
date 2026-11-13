const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const guard=require('../public/agent-response.js');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const context=vm.createContext({state:{},Water4EnergyAgentResponse:guard});
vm.runInContext(source.slice(source.indexOf('function messagesFromHistory('),source.indexOf('\nasync function loadSession(')),context);
const raw='<|start|>assistant<|channel|>commentary to=functions.run_bash <|constrain|>c{"command":"read saved file"}<|call|>';
const request=text=>({parts:[{part_kind:'user-prompt',content:text}]});
const response=text=>({parts:[{part_kind:'text',content:text}]});
test('an unreadable saved response is an error with a manual retry draft, not an agent answer',()=>{
 const messages=context.messagesFromHistory({message_history:[request('Question A'),response(raw)]});
 assert.equal(messages[1].role,'system');assert.equal(messages[1].error,true);
 assert.equal(messages[1].text,guard.MALFORMED_TOOL_MESSAGE);assert.equal(messages[1].retryPrompt,'Question A');
});
test('actual tool counts are scoped to their own user turn when history is restored',()=>{
 const messages=context.messagesFromHistory({message_history:[request('Question A'),{parts:[{part_kind:'tool-call',tool_name:'view'}]},response('Verified result'),request('Question B'),response(raw)]});
 assert.equal(messages[1].text,'Verified result');assert.equal(messages[3].error,true);assert.equal(messages[3].retryPrompt,'Question B');
});
test('normal answers, quoted protocol explanations and actual tool activity remain unchanged',()=>{
 const messages=context.messagesFromHistory({message_history:[request('Question A'),response('The error is 0.77°C.'),response('The log included: '+raw),{parts:[{part_kind:'tool-call',tool_name:'view'}]},response(raw)]});
 assert.equal(messages[1].text,'The error is 0.77°C.');assert.equal(messages[2].role,'agent');assert.equal(messages[3].role,'agent');
});
