import { tokenize } from "../utils/lua-utils";
import { propagateAliases } from "./alias-propagation";

const KNOWN = ["game","workspace","task","math","string","table","Enum","Instance","HttpService","Players","UserInputService","RunService","CoreGui","ReplicatedStorage","VirtualInputManager"] as const;
export interface SemanticRecoveryResult { result:string; changed:number; notes:string[] }

/** Recover only strong global/member references; never rename assignment targets. */
export function recoverSemanticIdentifiers(src:string):SemanticRecoveryResult{
  const aliases=propagateAliases(src,400); let work=aliases.result;
  const toks=[...tokenize(work)].filter(t=>!['eof','whitespace','newline','comment','longcomment'].includes(t.kind));
  const edits:Array<{start:number;end:number;text:string}>=[]; let changed=0;
  const known=new Set<string>(KNOWN);
  for(let i=0;i+3<toks.length;i++){
    const a=toks[i],b=toks[i+1],c=toks[i+2],d=toks[i+3];
    if(a.text!=="_G"||b.text!=="["||c.kind!=="string"||d.text!=="]")continue;
    const name=(c.value??"").replace(/^['\"]|['\"]$/g,"");
    if(!known.has(name))continue;
    // Do not rewrite an assignment target: `_G["x"] = ...` has d followed by `=`.
    if(toks[i+4]?.text==="=")continue;
    edits.push({start:a.start,end:d.end,text:name}); changed++;
  }
  if(edits.length){work=applyEdits(work,edits);}
  const total=aliases.changed+changed;
  if(!total)return{result:src,changed:0,notes:[]};
  return{result:work,changed:total,notes:[...(aliases.changed?aliases.notes:[]),...(changed?[`recovered ${changed} strong-evidence Roblox/Luau global reference(s).`]:[])]};
}
function applyEdits(src:string,edits:Array<{start:number;end:number;text:string}>):string{let p=0;const o:string[]=[];for(const e of [...edits].sort((a,b)=>a.start-b.start)){if(e.start<p)continue;o.push(src.slice(p,e.start),e.text);p=e.end;}o.push(src.slice(p));return o.join('');}
