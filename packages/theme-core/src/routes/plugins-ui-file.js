import path from "path";
import fs from "fs";
import crypto from "crypto";
import mime from "mime-types";

/** The package folders a theme process serves (`client` has its own route). */
export const UI_FILE_KINDS = ["controllers", "contract", "samples"];

/**
 * Resolves `plugins/<pluginId>/<kind>/<file>` and refuses anything outside `<kind>`.
 * @returns {{ status: number } | { filePath: string }}
 */
export function resolveUiFile(pluginId, kind, file, root = "plugins") {
  if (typeof pluginId !== "string" || typeof kind !== "string" || typeof file !== "string") return { status: 400 };
  if (!pluginId || !file) return { status: 400 };
  if (!UI_FILE_KINDS.includes(kind)) return { status: 404 };
  if (file.includes("\0") || file.includes("\\")) return { status: 403 };

  const safePluginId = path.basename(pluginId);
  if (safePluginId !== pluginId || safePluginId === "." || safePluginId === "..") return { status: 403 };

  // trailing separator: ".../contract" must not match ".../contract-evil/..."
  const baseDir = path.resolve(root, safePluginId, kind) + path.sep;
  const filePath = path.resolve(baseDir, file);
  if (!filePath.startsWith(baseDir)) return { status: 403 };
  return { filePath };
}

/** @type {import("@sveltejs/kit").RequestHandler} */
export async function GET({ params, request }) {
  const { pluginId, kind, file } = params;
  const resolved = resolveUiFile(pluginId, kind, file);

  if ("status" in resolved) {
    const messages = { 400: "Invalid parameters.", 403: "Access to this file is forbidden.", 404: "File not found or unable to read." };
    return new Response(messages[resolved.status], { status: resolved.status });
  }

  try {
    const data = fs.readFileSync(resolved.filePath);
    const ext = path.extname(resolved.filePath);
    const contentType =
      ext === ".svelte" ? "text/plain; charset=utf-8" : mime.lookup(resolved.filePath) || "application/octet-stream";
    // These files are not content-hashed: always revalidate, a strong ETag makes it a cheap 304.
    const etag = `"${crypto.createHash("sha1").update(data).digest("hex")}"`;
    const headers = {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    };

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(data, { headers });
  } catch {
    return new Response("File not found or unable to read.", { status: 404 });
  }
}
