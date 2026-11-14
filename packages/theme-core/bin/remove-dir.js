// Removes a directory tree. `rmSync(dir, { recursive: true, force: true })` alone is not enough: Bun on
// Windows (seen on 1.4.4) returns without an error and leaves the tree in place, so the install scripts'
// temp folders (`.lib-bundle-output`, `.runtime-shims-temp`) stayed in every repo. When the tree is still
// there afterwards it is walked and removed file by file.
import { existsSync, readdirSync, rmdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** @param {string} dir */
function removeTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      removeTree(full);
    } else {
      unlinkSync(full);
    }
  }

  rmdirSync(dir);
}

/**
 * Removes `dir` and everything in it; a missing `dir` is fine.
 * @param {string} dir
 */
export function removeDir(dir) {
  if (!existsSync(dir)) {
    return;
  }

  rmSync(dir, { recursive: true, force: true });

  if (existsSync(dir)) {
    removeTree(dir);
  }
}
