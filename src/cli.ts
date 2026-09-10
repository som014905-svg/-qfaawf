// CLI entry — deobfuscate một file .lua/.luau hoặc URL.
//
// Cách dùng:
//   bun run src/cli.ts <file.lua | URL> [tuỳ chọn]
//
// Tuỳ chọn:
//   -o, --out <file>     Đường dẫn output (mặc định: <tên>.deobf.lua)
//   --seq                Chạy engine tuần tự (an toàn bộ nhớ cho file lớn ≥300KB)
//   --timeout <ms>       Timeout mỗi engine (mặc định 30000)
//   --artifacts          Ghi thêm các artifact (chuỗi constants recover được)
//   --chain              Theo chuỗi loader: nếu script gọi loadstring(game:HttpGet(url))
//                        thì tự tải + deobf script đích (tối đa 15 bước)
//   --quiet              Chỉ in kết quả tóm tắt
//
// Ví dụ:
//   bun run src/cli.ts samples/gojotech.lua
//   bun run src/cli.ts samples/gojotech.lua -o out.lua --artifacts
//   bun run src/cli.ts "https://pastebin.com/raw/abc123"
//   bun run src/cli.ts "https://...loader..." --chain
//   bun run src/cli.ts big-script.lua --seq

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { runDeobfChain } from "./chain";
import { isProbablyUrl } from "./utils/fetcher";

interface CliArgs {
  input: string;
  out?: string;
  seq: boolean;
  timeout: number;
  artifacts: boolean;
  chain: boolean;
  quiet: boolean;
  deep: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: "", seq: false, timeout: 30_000, artifacts: false, chain: false, quiet: false, deep: 3 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error(`${a} yêu cầu đường dẫn output`);
      args.out = value;
    } else if (a === "--seq") {
      args.seq = true;
    } else if (a === "--timeout") {
      const value = argv[++i];
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--timeout không hợp lệ: ${value ?? ""}`);
      args.timeout = Math.min(300_000, Math.max(100, Math.floor(parsed)));
    } else if (a === "--artifacts") {
      args.artifacts = true;
    } else if (a === "--chain") {
      args.chain = true;
    } else if (a === "--deep") {
      const value = argv[++i];
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--deep không hợp lệ: ${value ?? ""}`);
      args.deep = Math.min(4, Math.floor(parsed));
    } else if (a === "--quiet" || a === "-q") {
      args.quiet = true;
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exitCode = 0;
      throw new CliExit();
    } else if (!args.input) {
      args.input = a;
    } else {
      throw new Error(`Đối số lạ: ${a}`);
    }
  }
  if (!args.input) {
    throw new Error("Thiếu input: hãy truyền file .lua/.luau hoặc URL");
  }
  return args;
}

function printHelp(): void {
  console.log(`
luau-deobf-engine CLI
──────────────────────
bun run src/cli.ts <file.lua | URL> [tuỳ chọn]

  -o, --out <file>   output (mặc định <tên>.deobf.lua)
  --seq              chạy engine tuần tự (file lớn ≥300KB)
  --timeout <ms>     timeout mỗi engine (mặc định 30000)
  --artifacts        ghi thêm artifact constants ra file
  --chain            theo chuỗi loadstring/HttpGet tới script đích (tối đa 15 bước)
  --deep <n>          nếu output còn obf, lấy output đó chạy lại tối đa n vòng (mặc định 3)
  --quiet, -q        chỉ in tóm tắt
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  // 1) Lấy input: URL hoặc file local.
  let input: string;
  let baseName: string;
  let sourceUrl: string | undefined;

  if (isProbablyUrl(args.input)) {
    sourceUrl = args.input;
    baseName = "script";
    input = ""; // chain runner sẽ tự fetch
  } else {
    input = readFileSync(args.input, "utf8");
    baseName = basename(args.input).replace(/\.(lua|luau|txt|md)$/i, "") || "script";
  }

  if (Buffer.byteLength(input, "utf8") > 8_000_000) {
    throw new Error("File quá lớn (>8MB)");
  }

  const inputSizeKB = Math.round((input.length || 1) / 1024);
  if (!args.quiet) {
    console.log(`──────────────────────────────────────────────`);
    console.log(`▶ Input: ${baseName} · ${inputSizeKB} KB${sourceUrl ? ` · ${sourceUrl}` : ""}${args.chain ? " · chain mode" : ""}`);
  }

  const logs: string[] = [];
  const chain = await runDeobfChain(
    sourceUrl ? { url: sourceUrl, baseName } : { source: input, baseName },
    {
      maxDepth: args.chain ? 15 : 0,
      deobf: {
        timeoutMs: args.timeout,
        acceptThreshold: 0.5,
        maxPasses: 10,
        minPassImprovement: 0.012,
        // Tự bật sequential cho file lớn (an toàn bộ nhớ) — trừ khi user ép --seq.
        parallel: args.seq ? false : undefined,
        deepRounds: Math.max(0, Math.min(4, args.deep)),
        deepMinImprovement: 0.008,
      },
    },
    (m) => {
      if (!args.quiet) logs.push(m);
    }
  );

  if (!args.quiet) {
    for (const l of logs) console.log(`  ${l}`);
  }

  const dur = Date.now() - t0;

  // Hiển thị chuỗi loader (nếu có nhiều hơn 1 bước).
  if (chain.steps.length > 1) {
    console.log(`──────────────────────────────────────────────`);
    console.log(`🔗 Chuỗi loader (${chain.steps.length} bước):`);
    for (const s of chain.steps) {
      const urlTxt = s.url ? ` · ${s.url.replace(/^https?:\/\//, "").slice(0, 80)}` : "";
      console.log(
        `  ${s.depth}. ${s.label} [${Math.round(s.bytes / 1024)}KB · ${s.obfuscator}/${Math.round(s.obfuscatorConfidence * 100)}% · engine: ${s.engine ?? "—"}]${urlTxt}`
      );
      if (s.note) console.log(`     ⚠ ${s.note}`);
      if (s.stopReason && !s.followedUrl) console.log(`     ⏹ ${s.stopReason}`);
      // Mọi liên kết tìm thấy trong bước này (không chặn host nào)
      if (s.urls && s.urls.length > 0) {
        console.log(`     🔗 ${s.urls.length} liên kết (kể cả Discord/YouTube/repo):`);
        for (const u of s.urls.slice(0, 8)) {
          console.log(`        · [${u.usage}] ${u.url.slice(0, 90)}`);
        }
        if (s.urls.length > 8) console.log(`        · … +${s.urls.length - 8} liên kết nữa`);
      }
    }
  }

  const report = chain.finalReport;

  console.log(`──────────────────────────────────────────────`);
  if (report) {
    console.log(`✔ Obfuscator phát hiện : ${report.detected.obfuscator} (${(report.detected.confidence * 100).toFixed(0)}%)`);
    if (report.fromCache) console.log(`✔ (kết quả từ cache)`);
    for (const s of report.steps) {
      const icon = s.success ? "✓" : s.ran ? "✗" : "-";
      console.log(
        `  ${icon} ${s.deobfuscator.padEnd(28)} conf=${(s.resultConfidence * 100).toFixed(0).padStart(3)}%  ${s.durationMs}ms${s.error ? `  LỖI: ${s.error}` : ""}`
      );
    }
  } else {
    // fallback: show detection of step 0
    const s0 = chain.steps[0];
    console.log(`✔ Obfuscator phát hiện : ${s0?.obfuscator ?? "—"} (${Math.round((s0?.obfuscatorConfidence ?? 0) * 100)}%)`);
  }

  if (!report?.best) {
    console.error(`✗ Không engine nào xử lý được input này.`);
    process.exitCode = 2;
    return;
  }

  const best = report.best;
  console.log(`──────────────────────────────────────────────`);
  console.log(`★ Engine thắng        : ${best.deobfuscator} · confidence ${(best.confidence * 100).toFixed(0)}%`);
  if (report.selectionNote) {
    console.log(`★ Chọn engine         : ${report.selectionNote}`);
  }
  console.log(`★ Validation          : ${report.validation ? report.validation.summary : "—"}`);
  if (best.notes && best.notes.length > 0) {
    console.log(`★ Ghi chú             :`);
    for (const n of best.notes) console.log(`    - ${n}`);
  }
  if (report.roblox?.found) {
    console.log(
      `★ Roblox API          : ${report.roblox.totalCalls} calls / ${report.roblox.usages.length} API${
        report.roblox.services.length ? ` · services: ${report.roblox.services.join(", ")}` : ""
      }`
    );
  }
  console.log(`★ Thời gian           : ${(dur / 1000).toFixed(2)}s`);

  // 2) Ghi output (v4: URL inputs derive the name from baseName, not the URL).
  const outPath = args.out ??
    (sourceUrl
      ? `${baseName || "script"}.deobf.lua`
      : `${args.input.replace(/\.(lua|luau|txt|md)$/i, "")}.deobf.lua`);
  mkdirSync(dirname(outPath) || ".", { recursive: true });
  writeFileSync(outPath, best.output, "utf8");
  const outKB = Math.round(best.output.length / 1024);
  console.log(`──────────────────────────────────────────────`);
  console.log(`💾 Output              : ${outPath} (${outKB} KB)`);

  // 3) Artifacts (constants recover được).
  if (args.artifacts && best.artifacts && best.artifacts.length > 0) {
    const artPath = outPath.replace(/\.deobf\.lua$/i, "") + ".artifacts.lua";
    writeFileSync(
      artPath,
      `-- Artifacts: constants recovered from ${baseName}\n-- Engine: ${best.deobfuscator}\n\n` +
        best.artifacts.join("\n\n"),
      "utf8"
    );
    console.log(`💾 Artifacts           : ${artPath} (${best.artifacts.length} mục)`);
  }

  if (report.validation && !report.validation.ok) {
    // Exit code 3 = có output nhưng syntax còn issue.
    process.exitCode = 3;
    return;
  }
}

class CliExit extends Error {
  constructor() {
    super("CLI_EXIT");
  }
}

main().catch((e) => {
  if (e instanceof CliExit) return;
  console.error(`✗ Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
