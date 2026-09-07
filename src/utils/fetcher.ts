// Fetches input source from a URL (raw pastebin, hastebin, github raw, gist,
// gitlab snippet/blob, srcshare, direct) or from a Discord message attachment.

export interface FetchedInput {
  source: "url" | "attachment";
  content: string;
  baseName: string;
  url?: string;
  filename: string;
  bytes: number;
}

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB hard cap on download

const RAW_HOST_PATTERNS: Array<{ re: RegExp; transform: (m: RegExpMatchArray) => string }> = [
  // pastebin.com/abc123 -> pastebin.com/raw/abc123  (also /print/ and /dl/)
  {
    re: /^https?:\/\/(?:www\.)?pastebin\.com\/(?:raw|print|dl)?\/?([A-Za-z0-9]{6,16})$/,
    transform: (m) => `https://pastebin.com/raw/${m[1]}`,
  },
  // hastebin.com/abc.lua -> hastebin.com/raw/abc
  {
    re: /^https?:\/\/(?:www\.)?hastebin\.com\/(?:raw\/)?([A-Za-z0-9._-]+)$/,
    transform: (m) => `https://hastebin.com/raw/${m[1]}`,
  },
  // rentry.co/abc -> rentry.co/raw/abc
  {
    re: /^https?:\/\/rentry\.co\/(?:raw\/)?([A-Za-z0-9_-]+)$/,
    transform: (m) => `https://rentry.co/raw/${m[1]}`,
  },
  // github.com/user/repo/blob/branch/path -> raw.githubusercontent.com
  {
    re: /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
    transform: (m) => `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`,
  },
  // gist.github.com/user/id -> gist.githubusercontent.com/user/id/raw
  {
    re: /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-fA-F]+)$/,
    transform: (m) => `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`,
  },
  // gitlab.com/user/repo/-/blob/branch/path -> .../-/raw/branch/path
  {
    re: /^https?:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/blob\/(.+)$/,
    transform: (m) => `https://gitlab.com/${m[1]}/${m[2]}/-/raw/${m[3]}`,
  },
  // gitlab.com/snippets/{id} -> .../snippets/{id}/raw
  {
    re: /^https?:\/\/gitlab\.com\/-\/snippets\/(\d+)$/,
    transform: (m) => `https://gitlab.com/-/snippets/${m[1]}/raw`,
  },
  // srcshare.io/abc
  {
    re: /^https?:\/\/srcshare\.io\/(?:lua\/)?([A-Za-z0-9_-]+)$/,
    transform: (m) => `https://srcshare.io/lua/${m[1]}`,
  },
  // ghostbin.com/abc -> /raw
  {
    re: /^https?:\/\/(?:www\.)?ghostbin\.com\/(?:raw\/)?([A-Za-z0-9._-]+)$/,
    transform: (m) => `https://ghostbin.com/raw/${m[1]}`,
  },
  // paste.ee/p/abc -> /r/abc
  {
    re: /^https?:\/\/paste\.ee\/(?:p|r)\/([A-Za-z0-9]+)$/,
    transform: (m) => `https://paste.ee/r/${m[1]}`,
  },
  // dpaste.org/abc
  {
    re: /^https?:\/\/dpaste\.org\/([A-Za-z0-9]+)$/,
    transform: (m) => `https://dpaste.org/${m[1]}.txt`,
  },
  // 0x0.st / teknik.io
  {
    re: /^https?:\/\/0x0\.st\/([A-Za-z0-9]+)$/,
    transform: (m) => `https://0x0.st/${m[1]}`,
  },
];

function normalizeUrl(raw: string): string {
  const url = raw.trim();
  for (const { re, transform } of RAW_HOST_PATTERNS) {
    const m = url.match(re);
    if (m) return transform(m);
  }
  return url;
}

export function isProbablyUrl(s: string): boolean {
  return /^https?:\/\/.+/i.test(s.trim());
}

/** Strip a leading/trailing markdown code fence if the entire text is fenced.
 *  e.g. ```lua\n<code>\n``` → <code>. */
function unwrapCodeFence(text: string): string {
  const trimmed = text.trim();
  const openMatch = trimmed.match(/^```[a-zA-Z]*\s*\n/);
  if (!openMatch) return text;
  if (!trimmed.endsWith("```")) return text;
  const inner = trimmed.slice(openMatch[0].length, trimmed.length - 3);
  return inner;
}

export async function fetchFromUrl(rawUrl: string): Promise<FetchedInput> {
  const url = normalizeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "luau-deobf-bot/2.0 (+discord)",
        // GitHub raw needs a UA, and we add Accept for gist API responses.
        Accept: "text/plain, text/*, application/json;q=0.9, */*;q=0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    const declaredLength = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      throw new Error(`File too large: ${(declaredLength / 1024 / 1024).toFixed(2)} MB (max 4 MB)`);
    }
    let text: string;
    try {
      text = await readTextWithLimit(res, MAX_BYTES);
    } catch (e) {
      if (e instanceof Error && e.message === "RESPONSE_TOO_LARGE") {
        throw new Error("File too large: response body exceeds 4 MB");
      }
      throw e;
    }
    // If the response is a GitHub gist API JSON, extract the first file.
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json") && url.includes("api.github.com/gists/")) {
      try {
        const j = JSON.parse(text);
        const files = Object.values(j.files ?? {}) as Array<{ content?: string; filename?: string }>;
        if (files.length > 0 && files[0].content) {
          text = files[0].content;
        }
      } catch {
        // not JSON or unexpected shape — keep raw text
      }
    }
    // Unwrap a markdown code fence if the whole payload is fenced.
    text = unwrapCodeFence(text);

    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_BYTES) {
      throw new Error(`File too large: ${(bytes / 1024 / 1024).toFixed(2)} MB (max 4 MB)`);
    }
    const filename = urlFromPath(url);
    return {
      source: "url",
      content: text,
      baseName: stripExt(filename),
      url,
      filename,
      bytes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readTextWithLimit(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response too large");
        throw new Error("RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString("utf8");
}

function urlFromPath(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "script";
    return decodeURIComponent(last) || "script";
  } catch {
    return "script";
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
