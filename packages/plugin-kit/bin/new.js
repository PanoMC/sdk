/**
 * pano-plugin new — scaffold a working Pano plugin (doc 02 section 8, decision 42).
 *
 *   bunx @panomc/plugin-kit new                          interactive: id, name, author, Kotlin package, install now
 *   bunx @panomc/plugin-kit new my-plugin                no questions, installs
 *   pano-plugin new my-plugin --package com.me.shop      Kotlin package (default com.example.<id without dashes>)
 *   pano-plugin new my-plugin --local <theme-core dir>   file: links to a local theme-core checkout
 *   pano-plugin new my-plugin --name "My Plugin" --author "Me" --no-install
 *
 * Run it inside Pano's `plugins/` folder: the folder is always the plugin id, because Pano finds a
 * plugin's dev sources at `plugins/<pluginId>`. An existing folder is refused.
 *
 * Everything the scaffold contains lives under `bin/templates/plugin/` and nowhere else: add a file
 * there, with `@@KEY@@` where a value goes, and every new plugin gets it. Special names:
 *   `__PKGPATH__`   the Kotlin package as a folder path       `_gitignore`  becomes `.gitignore`
 *   `__CLASS__`     the plugin class name without `Plugin`   `*.tpl`       loses its suffix
 * `.jar` and `.png` files are copied as they are.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { namespaceOf } from "../src/config.js";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(binDir, "..");
export const TEMPLATE_DIR = path.join(binDir, "templates", "plugin");

const ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PACKAGE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
/** Characters that would break a JSON string, a Svelte text, a properties value or a Kotlin string. */
const FORBIDDEN_TEXT = /[\u0000-\u001f"\\<>{}$`]|@@/;
const COPY_AS_IS = new Set([".jar", ".png"]);
const DEFAULT_AUTHOR = "CHANGE-ME";

const JAVA_KEYWORDS = new Set(
  (
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends " +
    "final finally float for goto if implements import instanceof int interface long native new package private " +
    "protected public return short static strictfp super switch synchronized this throw throws transient try void " +
    "volatile while true false null fun val var when object is in as typealias"
  ).split(" "),
);

export const NEW_HELP = `pano-plugin new - scaffold a Pano plugin

Usage: pano-plugin new [<id>] [options]

  <id>                     plugin id and folder name (kebab-case); asked for when left out
  --package <x.y>          Kotlin package (default com.example.<id without dashes>)
  --name <text>            display name (default: the id as a title)
  --author <text>          developer name (default ${DEFAULT_AUTHOR})
  --local [<dir>]          link @panomc/plugin-kit and @panomc/sdk from a local theme-core checkout
                           (the default while the kit is unpublished)
  --no-install             do not run bun install

Run it inside Pano's plugins/ folder. Without an id it asks five questions.
`;

/**
 * @typedef {object} NewOptions
 * @property {string} id
 * @property {string} name
 * @property {string} author
 * @property {string} pkg Kotlin package
 * @property {string | null} local absolute theme-core folder for file: links, or null for published versions
 * @property {boolean} install
 */

/**
 * @typedef {object} Prompts
 * @property {(question: { message: string, initial?: string, validate?: (value: string) => string | null }) => Promise<string>} text
 * @property {(question: { message: string, initial?: boolean }) => Promise<boolean>} confirm
 */

/**
 * @typedef {object} RunNewOptions
 * @property {string} [cwd] where the plugin folder is created, default the current directory
 * @property {boolean} [interactive] ask the questions when no id is given, default a TTY outside CI
 * @property {Prompts} [prompts] question source (tests), default clack or readline
 * @property {(dir: string) => number} [install] runs the dependency install, returns its exit code
 * @property {(line: string) => void} [out]
 * @property {(line: string) => void} [err]
 */

/** `my-plugin` -> `My Plugin`. */
export function titleFrom(id) {
  return id
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The plugin class name without its `Plugin` suffix: `my-plugin` -> `My`, `pano-plugin-market` -> `Market`,
 * `shop` -> `Shop`. The scaffold adds the suffix back (`MyPlugin`, `MarketPlugin`, `ShopPlugin`), so a
 * plugin called "...-plugin" does not end up as `MyPluginPlugin`.
 *
 * @param {string} id
 * @returns {string}
 */
export function classNameOf(id) {
  const words = id
    .replace(/^pano-plugin-/, "")
    .split("-")
    .filter(Boolean);

  if (words.length > 1 && words[words.length - 1] === "plugin") words.pop();

  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");

  // a Kotlin class name cannot start with a digit; ids start with a letter, but `pano-plugin-3d` would not
  return /^[0-9]/.test(name) ? `P${name}` : name;
}

/** `my-plugin` -> `com.example.myplugin`. */
export function defaultPackage(id) {
  return `com.example.${id.replace(/-/g, "")}`;
}

/**
 * @param {string} id
 * @param {string} cwd
 * @returns {string | null} the problem, or null
 */
export function checkId(id, cwd) {
  if (!ID_PATTERN.test(id) || id.length > 64) {
    return "the id must be kebab-case: lowercase letters, digits and single dashes, starting with a letter (my-plugin)";
  }

  try {
    namespaceOf(id);
  } catch (error) {
    return /** @type {Error} */ (error).message.replace(/^\[pano-plugin\] /, "");
  }

  if (fs.existsSync(path.resolve(cwd, id))) {
    return `${path.resolve(cwd, id)} already exists - refusing to overwrite; pick another id or remove the folder`;
  }

  return null;
}

/** @param {string} value @returns {string | null} */
export function checkPackage(value) {
  if (!PACKAGE_PATTERN.test(value)) {
    return `"${value}" is not a Kotlin package: lowercase letters, digits and "_" in dot-separated parts (com.example.shop)`;
  }

  const keyword = value.split(".").find((part) => JAVA_KEYWORDS.has(part));

  return keyword ? `"${keyword}" in the package is a reserved word: choose another part name` : null;
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {string | null}
 */
export function checkText(value, label) {
  if (!value || value.length > 80) return `${label} must be 1 to 80 characters`;

  return FORBIDDEN_TEXT.test(value)
    ? `${label} may not contain quotes, backslashes, < > { } $, backticks or control characters`
    : null;
}

/**
 * @param {string} dir
 * @returns {string | null} the problem, or null
 */
function checkLocalDir(dir) {
  for (const sub of ["packages/plugin-kit/package.json", "packages/sdk/package.json"]) {
    if (!fs.existsSync(path.join(dir, sub))) {
      return `--local ${dir} is not a theme-core checkout (${sub} is missing)`;
    }
  }

  return null;
}

/**
 * @param {string[]} args
 * @returns {{ id: string | null, flags: Record<string, string | boolean> }}
 */
export function parseNewArgs(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  /** @type {string[]} */
  const rest = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }

    const [name, inline] = arg.slice(2).split(/=(.*)/s);

    if (name === "no-install") flags.install = false;
    else if (name === "install") flags.install = true;
    else if (name === "help") flags.help = true;
    else if (name === "local") {
      // the directory is optional: `--local` alone means the checkout this kit sits in
      const next = args[i + 1];

      if (inline !== undefined) flags.local = inline;
      else if (next !== undefined && !next.startsWith("--")) flags.local = args[++i];
      else flags.local = true;
    } else if (name === "package" || name === "name" || name === "author") {
      const value = inline ?? args[++i];

      if (value === undefined) throw new Error(`--${name} needs a value`);

      flags[name] = value;
    } else throw new Error(`unknown option ${arg} (see pano-plugin new --help)`);
  }

  if (rest.length > 1) throw new Error(`one plugin id at most, got: ${rest.join(" ")}`);

  return { id: rest[0] ?? null, flags };
}

/**
 * The checkout a plain `--local` points at: the theme-core this kit lives in.
 *
 * @returns {string}
 */
function ownCheckout() {
  return path.resolve(kitDir, "..", "..");
}

/**
 * Template values for a plugin.
 *
 * @param {NewOptions} options
 * @param {string} kitVersion
 * @returns {Record<string, string>}
 */
export function templateValues(options, kitVersion) {
  const { id, name, author, pkg, local } = options;
  const org = author === DEFAULT_AUTHOR ? DEFAULT_AUTHOR : author.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || DEFAULT_AUTHOR;

  return {
    ID: id,
    NS: namespaceOf(id),
    NAME: name,
    AUTHOR: author,
    ORG: org,
    PACKAGE: pkg,
    PKGPATH: pkg.split(".").join("/"),
    CLASS: classNameOf(id),
    KIT_DEP: local ? `file:${path.join(local, "packages", "plugin-kit")}` : `^${kitVersion}`,
    SDK_DEP: local ? `file:${path.join(local, "packages", "sdk")}` : `^${kitVersion}`,
  };
}

/** @param {string} dir @returns {string[]} files below `dir`, relative, sorted */
function listFiles(dir) {
  /** @type {string[]} */
  const found = [];

  /** @param {string} current */
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) visit(full);
      else found.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };

  visit(dir);

  return found.sort();
}

/** @param {string} value @returns {string} non-ASCII as \uXXXX, the way a .properties file wants it */
function propertiesEscape(value) {
  return value.replace(/[^\u0000-\u007f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * Where a template file lands, relative to the new plugin folder.
 *
 * @param {string} relative
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function targetPath(relative, values) {
  let target = relative.replaceAll("__PKGPATH__", values.PKGPATH).replaceAll("__CLASS__", values.CLASS);

  if (target === "_gitignore") target = ".gitignore";
  if (target.endsWith(".tpl")) target = target.slice(0, -".tpl".length);

  return target;
}

/**
 * Writes the scaffold into `dir` (created) and returns the files written, relative.
 *
 * @param {string} dir
 * @param {Record<string, string>} values
 * @returns {string[]}
 */
export function writeScaffold(dir, values) {
  const written = [];

  for (const relative of listFiles(TEMPLATE_DIR)) {
    const source = path.join(TEMPLATE_DIR, relative);
    const target = path.join(dir, targetPath(relative, values));
    const mode = fs.statSync(source).mode;

    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (COPY_AS_IS.has(path.extname(relative))) {
      fs.copyFileSync(source, target);
    } else {
      const escape = target.endsWith(".properties") ? propertiesEscape : (value) => value;
      const content = fs
        .readFileSync(source, "utf8")
        .replace(/@@([A-Z_]+)@@/g, (match, key) => {
          if (!(key in values)) throw new Error(`template ${relative}: unknown placeholder ${match}`);

          return escape(values[key]);
        });

      fs.writeFileSync(target, content);
    }

    fs.chmodSync(target, mode & 0o777);
    written.push(path.relative(dir, target).split(path.sep).join("/"));
  }

  return written;
}

/**
 * Prompts through clack when it is installed, readline otherwise.
 *
 * @returns {Promise<Prompts>}
 */
async function defaultPrompts() {
  let clack = null;

  try {
    // computed specifier: the package is optional, and bun must not resolve it while loading this file
    clack = await import("@clack/" + "prompts");
  } catch {
    // plain questions below
  }

  if (clack) {
    const { cancelGuard } = await import("./ui.js");

    return {
      text: async ({ message, initial, validate }) =>
        String(
          cancelGuard(
            await clack.text({
              message,
              placeholder: initial,
              defaultValue: initial,
              validate: (value) => validate?.((value || initial || "").trim()) ?? undefined,
            }),
          ) || initial || "",
        ).trim(),
      confirm: async ({ message, initial }) =>
        Boolean(cancelGuard(await clack.confirm({ message, initialValue: initial ?? true }))),
    };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return {
    async text({ message, initial, validate }) {
      for (;;) {
        const answer = (await rl.question(`${message}${initial ? ` (${initial})` : ""} `)).trim() || initial || "";
        const problem = validate?.(answer) ?? null;

        if (!problem) return answer;

        process.stdout.write(`  ${problem}\n`);
      }
    },
    async confirm({ message, initial = true }) {
      const answer = (await rl.question(`${message} (${initial ? "Y/n" : "y/N"}) `)).trim().toLowerCase();

      return answer ? answer.startsWith("y") : initial;
    },
  };
}

/**
 * @param {string} dir
 * @returns {number}
 */
function bunInstall(dir) {
  const result = spawnSync("bun", ["install", "--backend=copyfile"], { cwd: dir, stdio: "ignore" });

  return result.status ?? 1;
}

/**
 * `pano-plugin new`. Returns the exit code.
 *
 * @param {string[]} argv arguments after `new`
 * @param {RunNewOptions} [options]
 * @returns {Promise<number>}
 */
export async function runNew(argv, options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const out = options.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line) => process.stderr.write(`${line}\n`));
  const kitPkg = JSON.parse(fs.readFileSync(path.join(kitDir, "package.json"), "utf8"));

  try {
    const { id: idArg, flags } = parseNewArgs(argv);

    if (flags.help) {
      out(NEW_HELP.trimEnd());

      return 0;
    }

    const interactive = options.interactive ?? (Boolean(process.stdout.isTTY) && !process.env.CI);

    // ---- inputs: everything is asked before a file is written, so cancelling leaves nothing behind
    /** @type {string} */
    let id;
    /** @type {string} */
    let name;
    /** @type {string} */
    let author;
    /** @type {string} */
    let pkg;
    let install = flags.install !== false;

    if (idArg === null) {
      if (!interactive) {
        throw new Error("a plugin id is required when there is no terminal: pano-plugin new <id> [--package x.y]");
      }

      const prompts = options.prompts ?? (await defaultPrompts());

      id = await prompts.text({
        message: "Plugin id (the folder name)?",
        initial: "my-plugin",
        validate: (value) => checkId(value, cwd),
      });
      name = await prompts.text({
        message: "Display name?",
        initial: /** @type {string} */ (flags.name) ?? titleFrom(id),
        validate: (value) => checkText(value, "the name"),
      });
      author = await prompts.text({
        message: "Author?",
        initial: /** @type {string} */ (flags.author) ?? DEFAULT_AUTHOR,
        validate: (value) => checkText(value, "the author"),
      });
      pkg = await prompts.text({
        message: "Kotlin package?",
        initial: /** @type {string} */ (flags.package) ?? defaultPackage(id),
        validate: checkPackage,
      });
      install = flags.install === undefined ? await prompts.confirm({ message: "Install dependencies with bun now?", initial: true }) : install;
    } else {
      id = idArg;
      name = /** @type {string | undefined} */ (flags.name) ?? titleFrom(id);
      author = /** @type {string | undefined} */ (flags.author) ?? DEFAULT_AUTHOR;
      pkg = /** @type {string | undefined} */ (flags.package) ?? defaultPackage(id);
    }

    for (const problem of [checkId(id, cwd), checkText(name, "the name"), checkText(author, "the author"), checkPackage(pkg)]) {
      if (problem) throw new Error(problem);
    }

    // ---- where the packages come from
    /** @type {string | null} */
    let local = null;

    if (typeof flags.local === "string") local = path.resolve(cwd, flags.local);
    else if (flags.local === true || kitPkg.version === "0.0.0-development") local = ownCheckout();

    if (local) {
      const problem = checkLocalDir(local);

      if (problem) throw new Error(problem);
    }

    // ---- write
    const dir = path.join(cwd, id);
    const values = templateValues({ id, name, author, pkg, local, install }, kitPkg.version);
    const files = writeScaffold(dir, values);

    out(`scaffolded ${id}/ (${files.length} files, ${local ? "local workspace links" : `kit ^${kitPkg.version}`})`);

    if (path.basename(cwd) !== "plugins") {
      out(`note: Pano finds a plugin's dev sources at <pano>/plugins/${id}; move the folder there before bun run dev`);
    }

    let installed = false;

    if (install) {
      out("installing dependencies (bun install)...");
      installed = (options.install ?? bunInstall)(dir) === 0;

      if (!installed) out("bun install did not complete: run it yourself in the plugin folder (add --backend=copyfile if it hangs)");
    }

    // The numbered lines are the "steps to first result" of doc 02 section 8: scaffold (this command), dev,
    // restart Pano. The install is part of the scaffold, not a step of its own.
    out("");
    out("Next:");
    out(`  1. cd ${id}${installed ? "" : " && bun install"} && bun run dev      (the first run builds the jar, it takes minutes)`);
    out(`  2. restart Pano once, then open /${id}`);
    out("");
    out("Steps to first result: 3 (scaffold, dev, restart Pano), 0 files written");

    return 0;
  } catch (error) {
    err(`pano-plugin new: ${/** @type {Error} */ (error).message}`);

    return 1;
  }
}
