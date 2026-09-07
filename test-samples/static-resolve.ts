import assert from "node:assert/strict";
import { inlineStaticTables, inlineOffsetTableLookups, inlineNumericCacheAccessors, normalizeStdlibAliases, normalizeEnvStdlibAliases, unwrapLiteralLoadstring, foldSimpleXorDecoderFunctions, foldEncodedStringTableLiterals } from "../src/passes/static-resolve";
import { validateLuaSource } from "../src/utils/validate";

const tables = inlineStaticTables(`local T={"hello","world",123}\nprint(T[1],T[2],T[3])`);
assert.equal(tables.changed, 3);
assert.match(tables.result, /"hello"/);
assert.match(tables.result, /"world"/);
assert.match(tables.result, /123/);

const aliases = normalizeStdlibAliases(`local ch=string.char\nlocal x=ch(65,66,67)`);
assert.ok(aliases.changed >= 1);
assert.match(aliases.result, /string\.char\(65,66,67\)/);

const bracketAliases = normalizeStdlibAliases(String.raw`local ch=string["char"]
local bx=bit32["bxor"]
local x=ch(65,66,67)
local y=bx(1,2)`);
assert.ok(bracketAliases.changed >= 2);
assert.match(bracketAliases.result, /string\.char\(65,66,67\)/);
assert.match(bracketAliases.result, /bit32\.bxor\(1,2\)/);

const deepAliases = normalizeStdlibAliases(String.raw`local a=bit32
local b=a
local c=b
local bx=c["bxor"]
local x=bx(1,2)`);
assert.ok(deepAliases.changed >= 2);
assert.match(deepAliases.result, /bit32\.bxor\(1,2\)/);

const envAliases = normalizeEnvStdlibAliases(String.raw`local env=getfenv()\nlocal ch=env["string"]["\099\104\097\114"]\nlocal x=ch(65,66,67)`);
assert.ok(envAliases.changed >= 1);
assert.match(envAliases.result, /string\.char\(65,66,67\)/);

const wrapped = unwrapLiteralLoadstring(`return loadstring("print(\'hello\')")()`);
assert.equal(wrapped.changed, 1);
assert.ok(!wrapped.result.includes("loadstring"));
assert.ok(validateLuaSource(wrapped.result).ok);



const xorFixture = String.raw`local function dec(data,key)
  local out={}
  for i=1,#data do
    table.insert(out,string.char(bit32.bxor(string.byte(string.sub(data,i,i+1)),string.byte(string.sub(key,1+(i%#key),1+(i%#key)+1)))%256))
  end
  return table.concat(out)
end
local x=dec("\\217\\215\\207","\\126\\177\\163")`;
const xorDecoded = foldSimpleXorDecoderFunctions(xorFixture);
assert.equal(xorDecoded.changed, 1);
assert.ok(!xorDecoded.result.includes('dec("'));



const offsetFixture = `local O={"alpha","beta","gamma"}\nlocal function B(x) return O[x + 10] end\nlocal a=B(-9)\nlocal b=B(-8)`;
const offsetDecoded = inlineOffsetTableLookups(offsetFixture);
assert.equal(offsetDecoded.changed, 2);
assert.match(offsetDecoded.result, /local a="alpha"/);
assert.match(offsetDecoded.result, /local b="beta"/);


const encodedTableFixture = `local L={"Z2V0U2VydmljZQ==","RmluZFNlcnZpY2U=","V29ya3NwYWNl","QXNzZXQ=","UmVtb3Zl","QWRkQ2hpbGQ=","Q2xvbmU=","RGVzdHJveQ=="}
print(L[1],L[2],L[3],L[4],L[5],L[6],L[7],L[8])`;
const encodedTables = foldEncodedStringTableLiterals(encodedTableFixture);
assert.equal(encodedTables.changed, 8);
assert.ok(encodedTables.result.includes('"GetService"') && encodedTables.result.includes('"FindService"'));
assert.ok(validateLuaSource(encodedTables.result).ok);

console.log("static-resolve: OK");

const cacheFixture = `local C={}\nC[1234567890123]="GetService"\nlocal function D(a,k) return C[k] end\nlocal x=D("\\129\\184",1234567890123)`;
const cacheDecoded = inlineNumericCacheAccessors(cacheFixture);

// v4.8.5: WeAreDevs arithmetic-noise in accessor offset + call argument
const weAreDevsArithmeticFixture = `local O = {"first", "second", "third", "fourth"}
local function B(B)return O[B+(421764+-377161)]end
return B(-44602), B(-44601), B(-44600)`;
const arithmeticDecoded = inlineOffsetTableLookups(weAreDevsArithmeticFixture);
assert.ok(arithmeticDecoded.changed === 3, `expected 3 arithmetic-offset lookups, got ${arithmeticDecoded.changed}`);
assert.ok(arithmeticDecoded.result.includes('"first"') && arithmeticDecoded.result.includes('"second"') && arithmeticDecoded.result.includes('"third"'));

assert.equal(cacheDecoded.changed, 1);
assert.match(cacheDecoded.result, /local x="GetService"/);
const cacheArithmeticFixture = `local C={}
C[-687327+32358950746043]="GetService"
local function D(a,k)return C[k]end
local x=D("\\129\\184",-687327+32358950746043)`;
const cacheArithmeticDecoded = inlineNumericCacheAccessors(cacheArithmeticFixture);
assert.equal(cacheArithmeticDecoded.changed, 1);
assert.match(cacheArithmeticDecoded.result, /local x="GetService"/);

