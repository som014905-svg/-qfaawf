import { recoverFunctionLevelVm } from "../src/passes/function-level-vm";

const fixture = `function demo()
  local state = 1
  local value = true
  while true do
    state = 100 - state
    if state < 99 then
      return 41
    elseif state < 100 then
      return 42
    else
      return 44
    end
  end
end
`;

const r = recoverFunctionLevelVm(fixture, { maxFunctions: 8, maxStates: 32, maxOutput: 12000 });
if (r.changed < 1) throw new Error("expected at least one function-level dispatcher recovery");
if (/while\s+true\s+do/.test(r.result)) throw new Error("dispatcher loop was not lifted");
if (!/return\s+42/.test(r.result)) throw new Error("terminal behavior disappeared");
console.log(`function-level-v600: OK (${r.functions} dispatcher(s), ${r.states} state visits)`);
