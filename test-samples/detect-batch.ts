import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { detectObfuscator } from "../src/detectors/detector";

const ROOT = process.env.CORPUS_DIR ? process.env.CORPUS_DIR : join(import.meta.dir, "..", "corpus", "upstream");

function walk(dir: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(lua|luau)$/i.test(name)) out.push(p);
  }
  return out;
}

function expectedFamily(path: string): string {
  return relative(ROOT, path).split(/[\\/]/)[0].toLowerCase();
}

const files = walk(ROOT);
if (!files.length) {
  console.log(`No local corpus found at ${ROOT}. Run: bun run corpus:update`);
  process.exit(0);
}

let ok = 0;
for (const file of files) {
  const input = readFileSync(file, "utf8");
  const d = detectObfuscator(input);
  const family = expectedFamily(file);
  const broad = `${d.obfuscator} ${d.evidence}`.toLowerCase();
  const likelyGeneric = d.obfuscator === "generic" && /^(77fuscator|boronide|hercules|ironbrew2|ironbrew1|ironbrew3|lps|luaobfuscator|luraph|moonsec|moonveil|psu|prometheus|synapsexen|wynfuscate)$/.test(family);
  if (!likelyGeneric && d.confidence >= 0.5) ok++;
  else console.log(`MISS ${relative(ROOT, file)} => ${d.obfuscator} ${(d.confidence * 100).toFixed(0)}% ${broad}`);
}
console.log(`detector sweep: ${ok}/${files.length} samples produced a non-generic >=50% detection`);
