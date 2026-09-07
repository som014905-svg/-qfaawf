import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { runDeobfuscation } from "../src/deobfuscators/orchestrator";

const ROOT = process.env.CORPUS_DIR ? process.env.CORPUS_DIR : join(import.meta.dir, "..", "corpus", "upstream");
const OUT = process.env.CORPUS_OUT ? process.env.CORPUS_OUT : join(import.meta.dir, "out", "corpus");
const TIMEOUT = Number(process.env.CORPUS_TIMEOUT_MS ?? "30000");

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

const files = walk(ROOT);
if (!files.length) {
  console.log(`No local corpus found at ${ROOT}. Run: bun run corpus:update`);
  process.exit(0);
}

let valid = 0;
const rows: any[] = [];
for (const file of files) {
  const input = readFileSync(file, "utf8");
  const start = Date.now();
  try {
    const r = await runDeobfuscation({
      input,
      baseName: relative(ROOT, file),
      source: "text",
      log: () => {},
    }, {
      timeoutMs: TIMEOUT,
      acceptThreshold: 0.5,
      maxPasses: 6,
      minPassImprovement: 0.015,
      parallel: input.length < 300_000,
      useCache: false,
    });
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const outPath = join(OUT, `${rel}.deobf.lua`);
    mkdirSync(dirname(outPath), { recursive: true });
    if (r.best?.output) writeFileSync(outPath, r.best.output, "utf8");
    const isValid = !!r.validation?.ok;
    if (isValid) valid++;
    rows.push({ file: rel, detected: r.detected, best: r.best?.deobfuscator ?? null, confidence: r.best?.confidence ?? 0, valid: isValid, ms: Date.now() - start });
    console.log(`${isValid ? "OK  " : "FAIL"} ${rel}`);
  } catch (e) {
    rows.push({ file: relative(ROOT, file), error: e instanceof Error ? e.message : String(e), ms: Date.now() - start });
    console.log(`ERR  ${relative(ROOT, file)}: ${e}`);
  }
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify({ total: files.length, valid, rows }, null, 2));
console.log(`deobf sweep: ${valid}/${files.length} outputs passed static validation`);
