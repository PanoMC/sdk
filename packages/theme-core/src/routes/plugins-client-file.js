import path from "path";
import fs from "fs";
import crypto from "crypto";
import mime from "mime-types";

// Content-hashed chunk, e.g. "Component-a1b2c3d4.js" or "chunk-1a2b3c4d.mjs". These names change
// whenever their content changes, so they are safe to cache forever.
const HASHED_CHUNK_RE = /-[0-9a-zA-Z_]{8,}\.m?js$/;

/**
 * Pick a Cache-Control (and optional ETag) for a plugin client asset.
 * @param {string} fileName
 * @param {Buffer} data
 */
function cacheHeadersFor(fileName, data) {
  if (fileName === "client.mjs") {
    // The entry point is not content-hashed, so it must always be revalidated. A trivial strong
    // ETag (content hash) lets the browser get a cheap 304 when nothing changed.
    const etag = `"${crypto.createHash("sha1").update(data).digest("hex")}"`;
    return { "Cache-Control": "no-cache", ETag: etag };
  }
  if (HASHED_CHUNK_RE.test(fileName)) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }
  return { "Cache-Control": "no-cache" };
}

/** @type {import("@sveltejs/kit").RequestHandler} */
export async function GET({ params, request }) {
  const { pluginId, fileName } = params;

  // Ensure pluginId and fileName are safe and sanitize inputs
  if (!pluginId || !fileName || typeof pluginId !== "string" || typeof fileName !== "string") {
    return new Response("Invalid parameters.", { status: 400 });
  }

  // Sanitize pluginId and fileName to prevent directory traversal
  const safePluginId = path.basename(pluginId); // Prevent directory traversal by using only the base name
  const safeFileName = path.basename(fileName); // Same for fileName

  // Resolve the plugin's client directory and append a trailing separator so the boundary check
  // below cannot be bypassed by a sibling directory whose name shares this prefix
  // (e.g. ".../client" must not match ".../client-evil/...").
  const baseDir = path.resolve(`plugins/${safePluginId}/client`) + path.sep;

  // Construct the absolute file path
  const filePath = path.resolve(baseDir, safeFileName);

  // Ensure that the resolved file stays inside the intended plugin's client directory.
  if (!filePath.startsWith(baseDir)) {
    return new Response("Access to this file is forbidden.", { status: 403 });
  }

  try {
    const data = fs.readFileSync(filePath);

    // Use mime-types to automatically determine the content type
    const contentType = mime.lookup(fileName) || "application/octet-stream"; // Default to 'application/octet-stream' if mime type is unknown

    const cacheHeaders = cacheHeadersFor(safeFileName, data);

    // Honor conditional requests when we expose an ETag (client.mjs).
    if (cacheHeaders.ETag && request.headers.get("if-none-match") === cacheHeaders.ETag) {
      return new Response(null, {
        status: 304,
        headers: { ...cacheHeaders }
      });
    }

    return new Response(data, {
      headers: { "Content-Type": contentType, ...cacheHeaders }
    });
  } catch {
    return new Response("File not found or unable to read.", { status: 404 });
  }
}
