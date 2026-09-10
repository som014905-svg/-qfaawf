import { tokenize } from "../utils/lua-utils";

export interface DispatcherMetrics {
  dispatcherResidue: number;
  aliasResidue: number;
  numericStateResidue: number;
  semanticApiRecovery: number;
  score: number;
}

/** Static structural metrics for ranking deobfuscator candidates. Higher is cleaner. */
export function measureDispatcherResidue(src: string): DispatcherMetrics {
  const tokens = [...tokenize(src)].filter(x => !["eof", "whitespace", "newline", "comment", "longcomment"].includes(x.kind));
  const txt = src;

  // Nested numeric decision-tree residue: count `if <numeric predicate> then if`
  // patterns plus numeric predicate density. Flat `elseif` chains score much better.
  const nestedNumericIf = (txt.match(/\bif\s+(?:tbl\d+|num\d+|state\d*)\s*(?:<|<=|>|>=|==)\s*-?\d+\s+then\s+if\b/gi) || []).length;
  const numericPredicates = (txt.match(/\b(?:tbl\d+|num\d+|state\d*)\s*(?:<|<=|>|>=|==)\s*-?\d+/g) || []).length;
  const totalIf = (txt.match(/\bif\b/gi) || []).length;
  const nestedRatio = nestedNumericIf / Math.max(1, totalIf);
  const dispatcherResidue = clamp01(1 - nestedRatio);

  // Opaque alias residue: direct temporary-to-temporary assignments.
  const aliasAssignments = (txt.match(/\b(?:tbl|num|fn|var)\d+\s*=\s*(?:tbl|num|fn|var)\d+\b/g) || []).length;
  const identifierCount = (txt.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []).length;
  const aliasResidue = clamp01(1 - aliasAssignments / Math.max(12, identifierCount * 0.22));

  // Numeric state residue: likely state/temporary variables receiving literal numbers.
  const numericStateAssignments = (txt.match(/\b(?:tbl|num|state)\d*\s*=\s*-?\d+\b/g) || []).length;
  const numericAssignmentDensity = numericStateAssignments / Math.max(1, identifierCount);
  const numericStateResidue = clamp01(1 - Math.min(1, numericAssignmentDensity * 5));

  // Semantic API recovery: known Roblox/Luau anchors relative to opaque identifiers.
  const api = (txt.match(/\b(?:game|workspace|task|Enum|Instance|HttpService|Players|UserInputService|RunService|ReplicatedStorage|CoreGui)\b/g) || []).length;
  const cryptic = tokens.filter(x => x.kind === "identifier" && /^(?:tbl|num|fn|var)\d+$/.test(x.text)).length;
  const semanticApiRecovery = clamp01(api / Math.max(8, api + cryptic * 0.08));

  const score = clamp01(
    dispatcherResidue * 0.42 + aliasResidue * 0.22 + numericStateResidue * 0.18 + semanticApiRecovery * 0.18
  );
  return { dispatcherResidue, aliasResidue, numericStateResidue, semanticApiRecovery, score };
}
function clamp01(x:number){ return Math.max(0, Math.min(1, x)); }
