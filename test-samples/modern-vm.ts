import assert from "node:assert/strict";
import { ModernVMDeobfuscator } from "../src/deobfuscators/modern-vm";

const d = new ModernVMDeobfuscator();

const davaFactory = `(function(t)local s=""for i=1,#t do s=s..string.char(t[i])end return s end){72,101,108,108,111}`;
const dr = await d.deobfuscate({ input: davaFactory, baseName: "dava", source: "text", log: () => {} });
assert.ok(dr.output.includes('"Hello"'), "Dava char-array factory should fold to Hello");

const davaVm = `local p={i={{1,0},{255,0}},k={},f={},u={}} local function xx(op) while true do if p.i[1][1]==1 then local x=1 elseif op==255 then return end end end`;
assert.equal(d.detect(davaVm)?.obfuscator, "modern_vm", "Dava custom VM shape should be detected");

const clyde = `local dec=function(t,k)local s={} for i=1,#t do s[i]=string.char(bit32.bxor(t[i],k)) end return table.concat(s) end local out=dec({27,10,7},42)`;
assert.equal(d.detect(clyde)?.obfuscator, "modern_vm", "Clyde XOR decoder shape should be detected");

console.log("modern-vm smoke OK");
