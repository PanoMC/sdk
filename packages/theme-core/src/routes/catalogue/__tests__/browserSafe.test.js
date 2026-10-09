import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// deps.js is bundled for the browser (the catalogue pages run there in theme dev mode). A static `node:*` import
// becomes an externalized stub that throws when a named import is read, so every catalogue page died with
// "Module node:path has been externalized for browser compatibility".
test("catalogue modules import no node: module statically", () => {
  for (const file of ["deps.js", "catalogue.js", "model.js", "stage.js", "list.js"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

    expect(text.match(/^\s*import\s[^;]*from\s+["']node:[^"']+["']/gm) ?? []).toEqual([]);
  }
});
