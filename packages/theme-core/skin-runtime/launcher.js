/**
 * Tier-0 skin launcher — the entire "server" of a rebuild-free Pano skin.
 *
 * A Tier-0 skin zip contains: manifest.json, screenshots, skin/tokens.css
 * (+ optional skin/assets/*), core-meta.json ({"tier":0}) and this file as
 * index.js. It ships NO SvelteKit build. At runtime it executes the SYSTEM
 * vanilla-theme's build — which the platform embeds in its jar and
 * auto-upgrades at every boot — so a pure-restyle skin receives every core,
 * login-flow and security update with ZERO author action and ZERO rebuilds.
 *
 * Resolution: the platform spawns `bun --smol run <themes>/<id>/index.js`
 * with cwd = Pano/ (NOT the theme dir), and every theme is a flat sibling
 * under the same folder, vanilla always at "vanilla-theme" (SYSTEM,
 * guaranteed present). PANO_SYSTEM_THEME_PATH, when the platform provides
 * it, wins over the sibling convention.
 *
 * Serving: vanilla's adapter-node exposes handler.js; we mount it behind a
 * tiny http server that (a) serves /pano-skin/* from the skin's own folder
 * and (b) injects the skin stylesheet + optional class hook into every HTML
 * response, buffered via a res-wrapper so Content-Length stays correct.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

const skinDir = import.meta.dirname ?? new URL(".", import.meta.url).pathname;

const vanillaDir =
  process.env.PANO_SYSTEM_THEME_PATH ??
  resolve(skinDir, "..", "vanilla-theme");

if (!existsSync(join(vanillaDir, "handler.js"))) {
  console.error(
    `[pano-skin] SYSTEM vanilla theme not found at ${vanillaDir} — cannot start`,
  );
  process.exit(1);
}

// Vanilla's server-side code resolves assets relative to its own files, but
// reads plugins/ relative to cwd — same as when vanilla runs directly, so
// plugin installation keeps working unchanged.
const { handler } = await import(
  pathToFileURL(join(vanillaDir, "handler.js")).href
);

const SKIN_PREFIX = "/pano-skin/";
const SKIN_CSS_TAG = `<link rel="stylesheet" href="/pano-skin/tokens.css">`;
const CSS_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function serveSkinFile(req, res) {
  const rel = req.url.slice(SKIN_PREFIX.length).split("?")[0];
  // Path traversal guard: resolved target must stay inside skin/.
  const file = resolve(skinDir, "skin", rel);
  if (!file.startsWith(resolve(skinDir, "skin")) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": CSS_TYPES[extname(file)] ?? "application/octet-stream",
    // Skin files only change when the skin zip is reinstalled; revalidation
    // is cheap and correctness beats cache lifetime here.
    "cache-control": "public, max-age=300, must-revalidate",
  });
  res.end(readFileSync(file));
}

/** Buffers HTML responses and injects the skin stylesheet before </head>. */
function wrapForInjection(res) {
  const chunks = [];
  let isHtml = null;
  const origWriteHead = res.writeHead.bind(res);
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.writeHead = (status, ...rest) => {
    const headers = typeof rest[0] === "object" ? rest[0] : rest[1];
    const ct =
      headers?.["content-type"] ??
      headers?.["Content-Type"] ??
      res.getHeader("content-type");
    isHtml = String(ct ?? "").includes("text/html");
    if (isHtml) {
      // Length changes after injection; drop it and let node chunk the body.
      if (headers) {
        delete headers["content-length"];
        delete headers["Content-Length"];
      }
      res.removeHeader?.("content-length");
    }
    return origWriteHead(status, ...rest);
  };
  res.write = (chunk, ...rest) => {
    if (isHtml) {
      chunks.push(Buffer.from(chunk));
      return true;
    }
    return origWrite(chunk, ...rest);
  };
  res.end = (chunk, ...rest) => {
    if (!isHtml) return origEnd(chunk, ...rest);
    if (chunk) chunks.push(Buffer.from(chunk));
    let body = Buffer.concat(chunks).toString("utf-8");
    const at = body.indexOf("</head>");
    if (at !== -1) {
      body = body.slice(0, at) + SKIN_CSS_TAG + body.slice(at);
    }
    return origEnd(body, ...rest);
  };
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

createServer((req, res) => {
  if (req.url.startsWith(SKIN_PREFIX)) {
    serveSkinFile(req, res);
    return;
  }
  wrapForInjection(res);
  handler(req, res, () => {
    res.writeHead(404).end();
  });
}).listen(port, host, () => {
  console.log(
    `[pano-skin] tier-0 skin serving vanilla from ${vanillaDir} on ${host}:${port}`,
  );
});
