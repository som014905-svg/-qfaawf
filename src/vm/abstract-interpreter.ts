import { tokenize } from "../utils/lua-utils";

export type AbstractValue = { kind:"number"; value:number } | { kind:"string"; value:string } | { kind:"boolean"; value:boolean } | { kind:"nil" } | { kind:"unknown" };
export interface AbstractState { vars:Record<string,AbstractValue>; transitions:number[]; constantsResolved:number; unsafeCalls:number }
export interface AbstractExecutionResult { state:AbstractState; notes:string[] }

export function abstractExecuteLua(src:string, stepLimit=4000):AbstractExecutionResult{
  const toks=[...tokenize(src)].filter(t=>!['eof','whitespace','newline','comment','longcomment'].includes(t.kind));
  const vars:Record<string,AbstractValue>={}; const transitions:number[]=[]; let constantsResolved=0; let unsafeCalls=0; let steps=0;
  for(let i=0;i+2<toks.length && steps++<stepLimit;i++){
    const a=toks[i], eq=toks[i+1], b=toks[i+2];
    if(a.kind==='identifier'&&eq.text==='='){
      if(b.kind==='number'){const n=Number(b.text.replaceAll('_',''));if(Number.isFinite(n)){vars[a.text]={kind:'number',value:n};constantsResolved++;if(/^(?:state|num\d*|tbl\d*)$/.test(a.text))transitions.push(n);}}
      else if(b.kind==='string'){vars[a.text]={kind:'string',value:b.value??b.text};constantsResolved++;}
      else if(b.kind==='keyword'&&(b.text==='true'||b.text==='false')){vars[a.text]={kind:'boolean',value:b.text==='true'};constantsResolved++;}
    }
    if(a.kind==='identifier'&&['loadstring','request','HttpGet','HttpPost','FireServer','FireClient'].includes(a.text)) unsafeCalls++;
  }
  return {state:{vars,transitions:[...new Set(transitions)],constantsResolved,unsafeCalls},notes:[`abstract interpreter resolved ${constantsResolved} scalar assignment(s), ${new Set(transitions).size} state-like numeric transition(s).`,`unsafe/dynamic call sites observed but not executed: ${unsafeCalls}.`]};
}
