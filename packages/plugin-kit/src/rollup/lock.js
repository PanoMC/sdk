import fs from "node:fs";
import path from "node:path";

/**
 * `pano-plugin.lock.json` (committed, written by non-watch builds), doc 01 section 2
 * and doc 02 section 5.2:
 *
 *   {
 *     "format": 1,
 *     "views":       { "<ns>:<Name>": { contract, props: {name: {required}}, slots, hooks, classes? } },
 *     "controllers": { "<ns>/<name>": { version, state: [..], actions: [..] } }
 *   }
 *
 * A section records what a view or controller promised the last time its number
 * (`contract` / `version`) was raised. A breaking change without a raised number is
 * reported by `diffSection`; additions only update the lock.
 */

export const LOCK_FILE = "pano-plugin.lock.json";
export const LOCK_FORMAT = 1;

/**
 * @typedef {{ format: number, views?: Record<string, any>, controllers?: Record<string, any> } & Record<string, any>} Lock
 */

/**
 * @typedef {object} SectionDiff
 * @property {boolean} changed the section differs from the stored one (a rewrite is needed)
 * @property {string[]} breaking one message per breaking change that did not raise its number
 */

/**
 * @param {string} root plugin root
 * @returns {string}
 */
export function lockPath(root) {
  return path.join(root, LOCK_FILE);
}

/**
 * Reads the lock file. A missing file is `{ format: 1 }`; an unreadable or malformed
 * file throws with the fix.
 *
 * @param {string} root plugin root
 * @returns {Lock}
 */
export function readLock(root) {
  const file = lockPath(root);

  if (!fs.existsSync(file)) return { format: LOCK_FORMAT };

  try {
    const lock = JSON.parse(fs.readFileSync(file, "utf8"));

    if (typeof lock !== "object" || lock === null || Array.isArray(lock)) {
      throw new Error("not an object");
    }

    return { format: LOCK_FORMAT, ...lock };
  } catch (error) {
    throw new Error(
      `[pano-plugin] ${LOCK_FILE} is not valid JSON (${error.message}): fix it, or delete it if this plugin was never published`,
    );
  }
}

/**
 * Recursively sorts object keys so the file is stable across builds (array order is kept).
 *
 * @param {any} value
 * @returns {any}
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }

  return value;
}

/**
 * Replaces one section of the lock file and keeps the others. Keys are sorted, the file
 * ends with a newline, and nothing is written when the content would not change.
 *
 * @param {string} root plugin root
 * @param {string} section `views` | `controllers` | any future section
 * @param {Record<string, any>} data
 * @returns {boolean} true when the file was written
 */
export function writeLockSection(root, section, data) {
  const lock = readLock(root);
  const next = sortKeys({ ...lock, format: LOCK_FORMAT, [section]: data });
  const text = JSON.stringify(next, null, 2) + "\n";
  const file = lockPath(root);

  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;

  fs.writeFileSync(file, text);

  return true;
}

/**
 * @param {any} value
 * @returns {string[]}
 */
function list(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Breaking changes of one view entry, in the order of doc 01 section 2: a prop removed,
 * a required prop added, `slots` / `hooks` changed, a class removed (when the lock holds
 * classes, i.e. the plugin has the `semanticClasses` badge).
 *
 * @param {string} id
 * @param {any} before
 * @param {any} after
 * @returns {string[]} problems, without the "set contract" tail
 */
function breakingViewChanges(id, before, after) {
  const problems = [];
  const beforeProps = before.props ?? {};
  const afterProps = after.props ?? {};

  for (const name of Object.keys(beforeProps)) {
    if (!(name in afterProps)) problems.push(`prop "${name}" removed`);
  }

  for (const name of Object.keys(afterProps)) {
    if (!(name in beforeProps) && afterProps[name]?.required) {
      problems.push(`required prop "${name}" added`);
    }
  }

  for (const key of ["slots", "hooks"]) {
    if (JSON.stringify(list(before[key])) !== JSON.stringify(list(after[key]))) {
      problems.push(`${key} changed`);
    }
  }

  if (Array.isArray(before.classes)) {
    for (const name of before.classes) {
      if (!list(after.classes).includes(name)) problems.push(`class ${name} removed`);
    }
  }

  return problems;
}

/**
 * @param {string} id
 * @param {any} before
 * @param {any} after
 * @returns {string[]}
 */
function breakingControllerChanges(id, before, after) {
  const problems = [];

  for (const key of list(before.state)) {
    if (!list(after.state).includes(key)) problems.push(`state '${key}' removed`);
  }

  for (const key of list(before.actions)) {
    if (!list(after.actions).includes(key)) problems.push(`action '${key}' removed`);
  }

  return problems;
}

/**
 * Compares the stored section with the freshly computed one.
 *
 * `breaking` holds one message for every entry whose contract (views) or version
 * (controllers) was not raised although something it promised is gone:
 *
 *   views:       `market:ProductCard: prop "settings" removed — set contract: 3 in ProductCard.svelte (never published? delete pano-plugin.lock.json)`
 *   controllers: `market/cart: action 'retry' removed — set version: 2 in src/theme/controllers/cart.js`
 *
 * Added entries and added optional keys are never breaking; they only set `changed`.
 * An entry missing from `next` (a deleted view or controller) is not breaking either.
 *
 * @param {"views" | "controllers" | string} section
 * @param {Record<string, any> | null | undefined} previous the stored section (null / undefined = none yet)
 * @param {Record<string, any>} next the freshly computed section
 * @returns {SectionDiff}
 */
export function diffSection(section, previous, next) {
  const changed = JSON.stringify(sortKeys(previous ?? null)) !== JSON.stringify(sortKeys(next));
  /** @type {string[]} */
  const breaking = [];

  if (!previous) return { changed, breaking };

  const numberKey = section === "controllers" ? "version" : "contract";

  for (const [id, after] of Object.entries(next)) {
    const before = previous[id];

    if (!before) continue;

    const oldNumber = Number(before[numberKey] ?? 1);
    const newNumber = Number(after[numberKey] ?? 1);

    if (newNumber > oldNumber) continue;

    const problems =
      section === "controllers"
        ? breakingControllerChanges(id, before, after)
        : breakingViewChanges(id, before, after);

    for (const problem of problems) {
      const raised = oldNumber + 1;

      breaking.push(
        section === "controllers"
          ? `${id}: ${problem} — set version: ${raised} in src/theme/controllers/${id.split("/").pop()}.js`
          : `${id}: ${problem} — set contract: ${raised} in ${id.split(":").pop()}.svelte (never published? delete ${LOCK_FILE})`,
      );
    }
  }

  return { changed, breaking };
}
