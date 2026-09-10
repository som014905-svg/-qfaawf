import { analyzeBinaryTreeDispatch, DispatcherAnalysis } from "../passes/binary-tree-dispatch";

export interface DispatcherGraphNode { id:string; kind:"root"|"comparison"|"leaf"; stateVariable?:string; operator?:string; constant?:number; }
export interface DispatcherGraph { nodes:DispatcherGraphNode[]; edges:Array<{from:string;to:string;condition:"true"|"false"|"fallthrough"}>; analyses:DispatcherAnalysis[] }

/** Build a lightweight structural graph summary from the same static detector
 * used by the binary-tree lifter. It intentionally does not execute the source.
 */
export function buildDispatcherGraph(src:string,maxLeaves=96):DispatcherGraph{
  const analyses=analyzeBinaryTreeDispatch(src,maxLeaves);
  const nodes:DispatcherGraphNode[]=[]; const edges:DispatcherGraph["edges"]=[];
  for(let i=0;i<analyses.length;i++){
    const a=analyses[i]; const root=`d${i}:root`; nodes.push({id:root,kind:"root",stateVariable:a.variables[0]});
    for(let j=0;j<a.comparisons;j++){
      const id=`d${i}:cmp${j}`; nodes.push({id,kind:"comparison",stateVariable:a.variables[0]});
      edges.push({from:j===0?root:`d${i}:cmp${j-1}`,to:id,condition:"fallthrough"});
    }
    for(let j=0;j<a.leaves;j++){
      const id=`d${i}:leaf${j}`; nodes.push({id,kind:"leaf"});
      edges.push({from:`d${i}:cmp${Math.max(0,a.comparisons-1)}`,to:id,condition:j%2===0?"true":"false"});
    }
  }
  return {nodes,edges,analyses};
}
