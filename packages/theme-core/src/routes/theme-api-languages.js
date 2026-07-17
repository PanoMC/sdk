import fs from "fs";
import path from "path";

/** @type {import("@sveltejs/kit").RequestHandler} */
export async function GET({ params }) {
  const { language } = params;

  // Sanitize the language id: strip any path components so a value like "../../etc/passwd"
  // collapses to a bare file name. This alone prevents traversal, and the startsWith check below
  // is an additional defense-in-depth boundary against symlink / edge-case escapes.
  const safe = path.basename(String(language ?? ""));
  const fileName = `${safe}.json`;

  // Build (dir, filePath) pairs for the primary and process.argv[1]-relative fallback locations.
  const candidates = [
    path.resolve("lang"),
    path.resolve(path.dirname(process.argv[1]) + "/lang"),
  ].map((dir) => ({ dir, filePath: path.resolve(dir, fileName) }));

  // Reject anything that escapes its lang directory.
  for (const { dir, filePath } of candidates) {
    if (!filePath.startsWith(dir + path.sep)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
  }

  let filePath = candidates[0].filePath;
  if (!fs.existsSync(filePath)) {
    filePath = candidates[1].filePath;
  }

  if (fs.existsSync(filePath)) {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return new Response(fileContent, {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } else {
    return new Response(JSON.stringify({ error: "Language file not found" }), {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}
