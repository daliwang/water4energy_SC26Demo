/* Identify an unexecuted tool-protocol reply. This helper never runs or retries work. */
(function(global){
  'use strict';
  const MALFORMED_TOOL_MESSAGE='The agent couldn’t complete this answer. Choose the question again, review it, then press Send to try again.';
  const START='<|start|>assistant';
  const END=/\s*<\|(?:call|end|im_end|yield)\|>\s*$/;

  function isRawToolBlock(block){
    if(!block.startsWith(START))return false;
    const messageAt=block.indexOf('<|message|>');
    const jsonAt=block.indexOf('{');
    const bodyAt=messageAt>=0?messageAt:(jsonAt>=0?jsonAt:-1);
    if(bodyAt<0)return false;
    const header=block.slice(0,bodyAt);
    // An assistant final/analysis frame alone is not evidence of a tool call.
    if(!/(?:^|\s)to=[A-Za-z_][A-Za-z0-9_.:-]*/.test(header))return false;
    if(!header.includes('<|channel|>')&&!header.includes('<|constrain|>'))return false;
    if(messageAt>=0){
      // Standard framed tool messages may contain non-JSON arguments. Require
      // a closing call marker so an explanation with protocol words is excluded.
      return /<\|call\|>\s*$/.test(block)&&block.slice(messageAt+'<|message|>'.length).replace(END,'').trim().length>0;
    }
    // Constrained argument blocks (including the provider's literal "c{" form)
    // must have a real JSON object body, not prose describing the notation.
    if(!header.includes('<|constrain|>')&&!/<\|call\|>\s*$/.test(block))return false;
    const body=block.slice(jsonAt).replace(END,'').trim();
    try{
      const args=JSON.parse(body);
      return Boolean(args&&typeof args==='object'&&!Array.isArray(args));
    }catch{return false;}
  }

  function isMalformedToolResponse(text,actualToolCalls=0){
    // Unknown/nonzero counts are conservative: this detector must never turn a
    // real tool event into a claim that the agent did nothing.
    if(actualToolCalls!==0||typeof text!=='string')return false;
    const value=text.trim();
    // Requiring protocol framing at the start leaves quoted examples, fenced
    // code, blockquotes and explanations containing these tokens untouched.
    if(!value.startsWith(START))return false;
    const blocks=value.split(/(?=<\|start\|>assistant)/).filter(Boolean);
    return blocks.length>0&&blocks.every(isRawToolBlock);
  }

  function requestPreview(text){
    if(typeof text!=='string')return null;
    const firstNewline=text.indexOf('\n');
    if(firstNewline<1||text[firstNewline+1]!=='\n')return null;
    const question=text.slice(0,firstNewline),details=text.slice(firstNewline+2);
    if(!question.trim())return null;
    const prefixes=['Water4Energy project — HEADWATER development.','Water4Energy project — Hypothesis lab · 24 October 2026.',
      'Case: 16–22 April 2019, issued 15 April 2019, in Water4Energy-TVA-agent-loop.'];
    if(!prefixes.some(prefix=>details.startsWith(prefix))||!details.includes('\nSaved-evidence answer\n'))return null;
    // Neither part is normalized: the original request can be reconstructed
    // exactly, and this view never changes what the person actually sent.
    return {question,details};
  }

  const api={isMalformedToolResponse,MALFORMED_TOOL_MESSAGE,requestPreview};
  global.Water4EnergyAgentResponse=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
