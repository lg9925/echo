// Tiny zero-dependency static server for the `out/` static export.
//
// Why this exists: production is this local machine behind a Cloudflare tunnel.
// We must NOT run `next dev` as production — dev mode disables the Serwist
// service worker (next.config: `disable: NODE_ENV === 'development'`), so it can
// never replace a stale SW already cached on a device, and it serves an
// unoptimized build. Instead we ship the real `pnpm build` output from `out/`,
// which includes a fresh `sw.js` (skipWaiting + clientsClaim) that takes over
// and evicts old caches.
//
// Deploy loop:  pnpm build  &&  pnpm serve   (serves on PORT, default 3000 —
// the same port the tunnel points at, so no tunnel reconfig needed).

import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("../out", import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// Map a request path to a file inside out/. Mirrors Next's trailingSlash export:
// `/zh/de/` → out/zh/de/index.html. Returns null if nothing matches.
async function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath.split("?")[0]);
  // normalize + block path traversal out of ROOT
  const safe = normalize(rel).replace(/^([/\\])+/, "");
  const base = join(ROOT, safe);
  if (!base.startsWith(ROOT)) return null;

  const candidates = rel.endsWith("/")
    ? [join(base, "index.html")]
    : [base, base + ".html", join(base, "index.html")];

  for (const c of candidates) {
    if (await isFile(c)) return c;
  }
  return null;
}

function cacheControl(pathname) {
  if (pathname === "/sw.js") return "no-cache, must-revalidate";
  if (pathname.startsWith("/_next/static/")) return "public, max-age=31536000, immutable";
  if (pathname.endsWith("/") || pathname.endsWith(".html")) return "no-cache";
  return "public, max-age=3600";
}

const server = createServer(async (req, res) => {
  try {
    const pathname = (req.url || "/").split("?")[0];
    let file = await resolveFile(req.url || "/");
    let status = 200;
    if (!file) {
      file = join(ROOT, "404.html");
      status = (await isFile(file)) ? 404 : null;
      if (status === null) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
    }
    const body = await readFile(file);
    res.writeHead(status, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": cacheControl(pathname),
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 Internal Server Error");
    console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`echo static server: serving ${ROOT} on http://localhost:${PORT}`);
});
