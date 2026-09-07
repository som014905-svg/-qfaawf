// Test harness: chạy engine qua mọi file trong ./samples và in bảng tóm tắt.
// Cách chạy:  bun run test-samples/run-tests.ts
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runDeobfuscation } from "../src/deobfuscators/orchestrator";
import { detectObfuscator } from "../src/detectors/detector";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(HERE, "..", "samples");
const OUT_DIR = join(HERE, "out");
mkdirSync(OUT_DIR, { recursive: true });

const TIMEOUT_MS = 30000;

interface Row {
  file: string;
  sizeKB: number;
  detected: string;
  best: string;
  bestConf: string;
  validation: string;
  durationMs: number;
}

async function main() {
  const files = readdirSync(SAMPLES_DIR)
    .filter((f) => /\.(lua|luau|txt)$/i.test(f))
    .sort();

  const rows: Row[] = [];

  for (const file of files) {
    const path = join(SAMPLES_DIR, file);
    const input = readFileSync(path, "utf8");
    const sizeKB = Math.round(input.length / 1024);

    console.log(`\n──────────────────────────────────────────────`);
    console.log(`▶ ${file} (${sizeKB} KB)`);

    const det = detectObfuscator(input);
    console.log(`  detect: ${det.obfuscator} @ ${(det.confidence * 100).toFixed(0)}% — ${det.evidence}`);

    const logs: string[] = [];
    const ctx = {
      input,
      baseName: file.replace(/\.(lua|luau|txt)$/i, ""),
      source: "text" as const,
      log: (m: string) => logs.push(m),
    };

    const t0 = Date.now();
    const row: Row = {
      file,
      sizeKB,
      detected: det.obfuscator,
      best: "—",
      bestConf: "—",
      validation: "—",
      durationMs: 0,
    };

    try {
      const report = await runDeobfuscation(ctx, {
        timeoutMs: TIMEOUT_MS,
        acceptThreshold: 0.5,
        maxPasses: 6,
        minPassImprovement: 0.015,
        // File nhỏ chạy parallel cho nhanh; file lớn chạy sequential tránh OOM.
        parallel: input.length < 300_000,
      });

      if (report.best) {
        row.best = report.best.deobfuscator;
        row.bestConf = `${(report.best.confidence * 100).toFixed(0)}%`;
        const outPath = join(OUT_DIR, file.replace(/\.(lua|luau|txt)$/i, "") + ".deobf.lua");
        writeFileSync(outPath, report.best.output, "utf8");
        if (report.best.artifacts && report.best.artifacts.length > 0) {
          writeFileSync(
            outPath.replace(/\.deobf\.lua$/i, "") + ".artifacts.lua",
            report.best.artifacts.join("\n\n"),
            "utf8"
          );
        }
        writeFileSync(
          outLogPath(file),
          logs.join("\n") +
            `\n\n--- summary ---\n${JSON.stringify(
              {
                detected: report.detected,
                best: report.best.deobfuscator,
                confidence: report.best.confidence,
                validation: report.validation?.summary,
              },
              null,
              2
            )}\n`,
          "utf8"
        );
      }
      row.validation = report.validation
        ? report.validation.ok
          ? "✓ VALID"
          : `✗ ${report.validation.issues.length} issues`
        : "—";
      row.durationMs = Date.now() - t0;
    } catch (e: unknown) {
      row.validation = `LỖI: ${e instanceof Error ? e.message : String(e)}`;
      row.durationMs = Date.now() - t0;
    }

    rows.push(row);
    // Optional GC hint; works on Node (with --expose-gc) and Bun.
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc === "function") gc();
  }

  // Bảng tóm tắt
  console.log(`\n\n════════ TỔNG KẾT ════════`);
  console.log(
    `File`.padEnd(22) +
      `KB`.padStart(5) +
      `Detector`.padEnd(14) +
      `Engine thắng`.padEnd(30) +
      `Conf`.padStart(5) +
      `Validation`.padStart(12) +
      `Time`.padStart(8)
  );
  console.log("─".repeat(96));
  for (const r of rows) {
    console.log(
      r.file.padEnd(22) +
        String(r.sizeKB).padStart(5) +
        r.detected.padEnd(14) +
        r.best.padEnd(30) +
        r.bestConf.padStart(5) +
        r.validation.padStart(12) +
        `${(r.durationMs / 1000).toFixed(1)}s`.padStart(8)
    );
  }
  const valid = rows.filter((r) => r.validation === "✓ VALID").length;
  console.log("─".repeat(96));
  console.log(`→ ${valid}/${rows.length} samples VALID`);
}

function outLogPath(file: string): string {
  return join(OUT_DIR, file.replace(/\.(lua|luau|txt)$/i, "") + ".log.txt");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
