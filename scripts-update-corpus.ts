// Refreshes a local mirror of terrorlua/obfuscator-samples using GitHub's public API.
// Usage: bun run corpus:update
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const repo = process.env.CORPUS_REPO ?? "terrorlua/obfuscator-samples";
const ref = process.env.CORPUS_REF ?? "main";
const outDir = resolve(process.env.CORPUS_DIR ?? join(import.meta.dir, "corpus", "upstream"));
const maxBytes = Number(process.env.CORPUS_MAX_BYTES ?? "5000000");

type GithubEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  sha?: string;
  download_url?: string;
};

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "luau-deobf-engine" } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${url}`);
  return r.json();
}

async function listLuaFiles(path = ""): Promise<GithubEntry[]> {
  const url = `https://api.github.com/repos/${repo}/contents/${path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(ref)}`;
  const entries = (await getJson(url)) as GithubEntry[];
  if (!Array.isArray(entries)) throw new Error(`GitHub contents response is not a directory: ${path || "."}`);

  const files: GithubEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "dir") files.push(...(await listLuaFiles(entry.path)));
    else if (entry.type === "file" && /\.(lua|luau)$/i.test(entry.path)) files.push(entry);
  }
  return files;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  // The recursive Git Trees endpoint returns HTTP 500 for this large public
  // corpus. Contents API traversal is slower but bounded per directory and
  // works for both large repositories and smaller forks.
  const files = await listLuaFiles();
  const manifest: any[] = [];
  const families = new Set<string>();
  let downloaded = 0;
  let skipped = 0;

  for (const file of files) {
    families.add(file.path.split("/")[0] ?? "");
    const size = Number(file.size ?? 0);
    if (size > maxBytes) {
      skipped++;
      manifest.push({ path: file.path, skipped: true, reason: `size>${maxBytes}`, size });
      continue;
    }
    const rawUrl = file.download_url ?? `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(rawUrl, { headers: { "User-Agent": "luau-deobf-engine" } });
    if (!r.ok) throw new Error(`Raw fetch ${r.status}: ${file.path}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const dest = join(outDir, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    manifest.push({ path: file.path, size: bytes.byteLength, sha256: sha256(bytes), upstreamSha: file.sha });
    downloaded++;
    if (downloaded % 25 === 0) console.log(`downloaded ${downloaded}/${files.length}`);
  }

  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ repo, ref, generatedAt: new Date().toISOString(), downloaded, skipped, families: [...families].sort(), files: manifest }, null, 2));
  console.log(`corpus:update complete — ${downloaded} files, ${skipped} skipped, ${families.size} families, dir=${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
