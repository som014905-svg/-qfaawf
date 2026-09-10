import { tokenize, LuaToken } from "../utils/lua-utils";

export interface AliasPropagationResult { result: string; changed: number; notes: string[] }
type Tok = LuaToken & { i:number };
function sig(src:string):Tok[]{const out:Tok[]=[];let i=0;for(const t of tokenize(src)){if(["eof","whitespace","newline","comment","longcomment"].includes(t.kind))continue;out.push(Object.assign(t,{i:i++}));}return out as Tok[];}
function applyEdits(src:string, edits:Array<{start:number;end:number;text:string}>):string{let p=0;const out:string[]=[];for(const e of [...edits].sort((a,b)=>a.start-b.start)){if(e.start<p)continue;out.push(src.slice(p,e.start),e.text);p=e.end;}out.push(src.slice(p));return out.join("");}

/** Conservative alias propagation. Only immutable local aliases are rewritten:
 * `local a = b` may become direct references to `b` when both `a` and `b` are
 * assigned exactly once (the declaration for `a`) and the source variable has
 * no writes elsewhere. This avoids changing Lua value-at-assignment semantics.
 */
export function propagateAliases(src:string,maxAliases=160):AliasPropagationResult{
  const t=sig(src); const writes=new Map<string,number>(); const locals=new Set<string>(); const aliases=new Map<string,string>();
  for(let i=0;i+2<t.length;i++){
    if(t[i].text==="local"&&t[i+1]?.kind==="identifier"&&t[i+2]?.text==="="){locals.add(t[i+1].text); writes.set(t[i+1].text,(writes.get(t[i+1].text)??0)+1);}
    else if(t[i].kind==="identifier"&&t[i+1]?.text==="="){writes.set(t[i].text,(writes.get(t[i].text)??0)+1);}
  }
  for(let i=0;i+3<t.length;i++){
    if(t[i].text!=="local"||t[i+1]?.kind!=="identifier"||t[i+2]?.text!=="="||t[i+3]?.kind!=="identifier")continue;
    const a=t[i+1].text,b=t[i+3].text;
    if(a===b||(writes.get(a)??0)!==1)continue;
    if((writes.get(b)??0)!==0 && !locals.has(b))continue;
    aliases.set(a,b);
  }
  const resolve=(x:string)=>{let cur=x;const seen=new Set<string>();while(aliases.has(cur)&&!seen.has(cur)){seen.add(cur);cur=aliases.get(cur)!;}return cur;};
  const edits:Array<{start:number;end:number;text:string}>=[]; let changed=0;
  for(let i=0;i<t.length;i++){
    const x=t[i]; if(x.kind!=="identifier"||!aliases.has(x.text))continue;
    if(i>0&&t[i-1].text===".")continue;
    if(i+1<t.length&&t[i+1].text==="=")continue;
    const r=resolve(x.text); if(r!==x.text){edits.push({start:x.start,end:x.end,text:r});changed++;if(changed>=maxAliases)break;}
  }
  if(!changed)return{result:src,changed:0,notes:[]};
  return{result:applyEdits(src,edits),changed,notes:[`propagated ${changed} immutable local alias reference(s).`]};
}
