import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { writable } from "svelte/store";

// Server-renders the engine parts of TC-20 (Main, Sidebar, Breadcrumb, Post, Posts, Tickets,
// TicketRow, TicketStatus) with a tiny module graph: `.svelte` files are compiled from `root`
// (falling back to the real package), plain `.js` files are imported from the real package, and
// the SvelteKit / i18n / UI helpers are stubs. The same graph builder renders the original
// (pre-split) sources for the snapshot and the new controller + part files.

const pkgDir = resolve(import.meta.dir, "..", "..", "..");

export function findSvelte() {
  for (const from of [import.meta.dir, join(pkgDir, "../../../themes/vanilla-theme/package.json")]) {
    try {
      return join(createRequire(from).resolve("svelte/package.json"), "..");
    } catch {
      // try the next location
    }
  }
  return null;
}

const STUB_JS = {
  "svelte-i18n": `import { readable } from "svelte/store";
export const _ = readable((key, options) => (options && options.values && Object.keys(options.values).length ? key + JSON.stringify(options.values) : key));`,
  "$app/environment": `export const dev = false; export const browser = false;`,
  "@theme-style": `export {};`,
  // ViewComponent reads the pano context for wrapInjected; without one it renders the module as before
  "@panomc/sdk/internal": `export const getPanoContext = () => ({});`,
  "$pano/lib/tooltip.util": `export default function tooltip() {}`,
  "$pano/lib/Store": `import { readable } from "svelte/store"; export const avatarVersion = readable("v7");`,
};

const STUB_SVELTE = {
  "$pano/lib/components/Date.svelte": `<span class="date-stub {$$props.class ?? ''}">{time}</span>\n<script>export let time;</script>`,
};

/**
 * @param {object} args
 * @param {string} args.svelteDir
 * @param {string} [args.root]  folder with a `src/lib/...` overlay of .svelte files (default: the real package)
 * @param {Record<string, string>} [args.extraSvelte]  specifier -> .svelte source (stubs, overrides)
 * @param {string} args.entry  specifier of the component to render
 * @param {object} [args.props]
 * @param {Map<any, any>} [args.context]
 * @param {string} [args.slot]  svelte markup rendered inside the component's default slot
 * @returns {Promise<string>}
 */
export async function renderPart({ svelteDir, root = pkgDir, extraSvelte = {}, entry, props = {}, context, slot }) {
  const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
  const dir = mkdtempSync(join(tmpdir(), "tc20-ssr-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(svelteDir, join(dir, "node_modules", "svelte"), "dir");

  /** @type {Map<string, string>} */
  const written = new Map();
  let counter = 0;

  const fromPackage = (rel) => join(pkgDir, "src", rel);

  /** @returns {{ kind: "js" | "svelte" | "bare", file?: string, source?: string }} */
  function locate(specifier, importerDir) {
    if (specifier in STUB_JS) return { kind: "js", source: STUB_JS[specifier], file: `stub:${specifier}` };
    if (specifier in STUB_SVELTE) return { kind: "svelte", source: STUB_SVELTE[specifier], file: `stub:${specifier}` };
    if (specifier in extraSvelte) return { kind: "svelte", source: extraSvelte[specifier], file: `extra:${specifier}` };

    let candidates = [];
    if (specifier.startsWith("$pano/")) {
      const rel = specifier.slice("$pano/".length);
      candidates = [join(root, "src", rel), fromPackage(rel)];
    } else if (specifier.startsWith(".") || isAbsolute(specifier)) {
      candidates = [resolve(importerDir, specifier)];
    } else {
      return { kind: "bare" };
    }

    for (const candidate of candidates) {
      const file = existsSync(candidate) ? candidate : existsSync(candidate + ".js") ? candidate + ".js" : null;
      if (file) return { kind: file.endsWith(".svelte") ? "svelte" : "js", file };
    }
    throw new Error(`cannot resolve ${specifier} from ${importerDir}`);
  }

  /** Writes the module for a located file and returns the path to import. */
  function emit(loc, specifier) {
    if (loc.kind === "bare") return specifier;
    if (loc.kind === "js" && !loc.file.startsWith("stub:")) return loc.file; // the real module, shared with the test

    const key = loc.file;
    if (written.has(key)) return written.get(key);

    const out = join(dir, `m${counter++}.mjs`);
    written.set(key, out);

    let code;
    let sourceDir = pkgDir;
    if (loc.kind === "svelte") {
      const source = loc.source ?? readFileSync(loc.file, "utf-8");
      if (loc.file && !loc.file.includes(":")) sourceDir = dirname(loc.file);
      code = compiler.compile(source, { generate: "server", filename: loc.file.includes(":") ? "Part.svelte" : loc.file.slice(pkgDir.length + 1) }).js.code;
    } else {
      code = loc.source;
    }

    code = code.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g, (whole, lead, quote, spec) => {
      if (spec.startsWith("svelte/") || spec === "svelte") return whole;
      const target = emit(locate(spec, sourceDir), spec);
      return `${lead}${JSON.stringify(target)}`;
    });
    writeFileSync(out, code);
    return out;
  }

  try {
    const harness = `<script>
  import Part from ${JSON.stringify(entry)};
  export let props = {};
</script>
${slot === undefined ? "<Part {...props} />" : `<Part {...props}>${slot}</Part>`}`;
    const file = emit({ kind: "svelte", source: harness, file: "extra:harness" }, "harness");
    const { default: Component } = await import(file);
    const { render } = await import(join(svelteDir, "src", "server", "index.js"));

    return render(Component, { props: { props }, ...(context ? { context } : {}) }).body;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A hand-written server component used as the `sidebar` context value (Svelte 5 server signature). */
export function SidebarStub($$renderer, $$props) {
  $$renderer.push(`<aside class="stub-sidebar" data-side="${$$props.side ?? ""}" data-foo="${$$props.foo ?? ""}"></aside>`);
}

export function mainContext({ pageTitle, sidebarProps = {}, themeSettings = {}, withSidebar = true }) {
  return new Map([
    ["pageTitle", writable(pageTitle)],
    ["sidebar", writable(withSidebar ? SidebarStub : null)],
    ["sidebarProps", writable(sidebarProps)],
    ["themeSettings", themeSettings],
  ]);
}

/** The cases of the snapshot: stable names, props and context are plain data. */
export function buildCases() {
  const post = (n, extra = {}) => ({
    url: `post-${n}`,
    title: `Post ${n}`,
    text: `<p>Body <b>${n}</b> ${"lorem ".repeat(30)}</p>`,
    views: 10 * n,
    date: "1700000000000",
    category: { title: n % 2 ? "News" : "-", url: `cat-${n}` },
    writer: { username: `writer${n}` },
    thumbnailUrl: n === 1 ? "/img/p1.png" : undefined,
    ...extra,
  });
  const ticket = (n, status, extra = {}) => ({
    id: n,
    title: `Ticket ${n}`,
    status,
    category: { title: n % 2 ? "-" : "Bug", url: `c${n}` },
    lastUpdate: "1700000000000",
    ...extra,
  });

  const bc = (items) => ({ context: () => new Map([["breadcrumbs", writable(items)]]) });

  return {
    "Main/default": {
      entry: "$pano/lib/components/Main.svelte",
      slot: `<p id="slot">content</p>`,
      context: () => mainContext({ pageTitle: "home.title", sidebarProps: { foo: 1 } }),
    },
    "Main/left-sidebar-from-props": {
      entry: "$pano/lib/components/Main.svelte",
      slot: `<p id="slot">content</p>`,
      context: () => mainContext({ pageTitle: { title: "Raw", raw: true, subtitle: "Sub" }, sidebarProps: { side: "left" } }),
    },
    "Main/no-sidebar-setting": {
      entry: "$pano/lib/components/Main.svelte",
      slot: `<p id="slot">content</p>`,
      context: () => mainContext({ pageTitle: null, themeSettings: { sidebarEnabled: false } }),
    },
    "Main/hidden-title-left-setting": {
      entry: "$pano/lib/components/Main.svelte",
      slot: `<p id="slot">content</p>`,
      context: () =>
        mainContext({ pageTitle: { title: "t", hidden: true }, themeSettings: { sidebarEnabled: true, sidebarPosition: "LEFT" } }),
    },
    "Main/no-sidebar-component": {
      entry: "$pano/lib/components/Main.svelte",
      slot: `<p id="slot">content</p>`,
      context: () => mainContext({ pageTitle: "t", withSidebar: false }),
    },
    "Sidebar/default": { entry: "$pano/lib/components/Sidebar.svelte", slot: `<i>w</i>`, props: {} },
    "Sidebar/left": { entry: "$pano/lib/components/Sidebar.svelte", slot: `<i>w</i>`, props: { side: "left" } },
    "Breadcrumb/items": {
      entry: "$pano/lib/components/Breadcrumb.svelte",
      ...bc([
        "nav.home",
        { label: "nav.profile", labelValues: { a: 1 }, href: "/profile", icon: "fas fa-user" },
        { label: "<b>Raw</b>", html: true, href: "/raw" },
        { label: "Plain", raw: true, href: "/plain" },
        { label: "nav.last", href: "/ignored" },
      ]),
    },
    "Breadcrumb/last-icon-html": {
      entry: "$pano/lib/components/Breadcrumb.svelte",
      ...bc([{ label: "x", href: "/x" }, { label: "<i>y</i>", html: true }]),
    },
    "Breadcrumb/empty": { entry: "$pano/lib/components/Breadcrumb.svelte", ...bc([]) },
    "Breadcrumb/not-array": { entry: "$pano/lib/components/Breadcrumb.svelte", ...bc(null) },
    "Post/overlay-thumbnail": {
      entry: "$pano/lib/components/Post.svelte",
      props: { post: post(1) },
      context: () => new Map([["themeSettings", {}]]),
    },
    "Post/overlay-plain-no-author-image": {
      entry: "$pano/lib/components/Post.svelte",
      props: { post: post(2) },
      context: () => new Map([["themeSettings", { postAuthorImageEnabled: false }]]),
    },
    "Post/overlay-category": {
      entry: "$pano/lib/components/Post.svelte",
      props: { post: post(3) },
      context: () => new Map([["themeSettings", {}]]),
    },
    "Post/detail": {
      entry: "$pano/lib/components/Post.svelte",
      props: { post: post(1), detail: true },
      context: () => new Map([["themeSettings", {}]]),
    },
    "Post/detail-settings-off": {
      entry: "$pano/lib/components/Post.svelte",
      props: { post: post(4), detail: true },
      context: () =>
        new Map([["themeSettings", { postCoverImageEnabled: false, postViewCountEnabled: false, postAuthorImageEnabled: false }]]),
    },
    "Posts/list": {
      entry: "$pano/lib/components/Posts.svelte",
      props: { posts: [post(1), post(2), post(3)] },
      context: () => new Map([["themeSettings", {}]]),
    },
    "Posts/empty": {
      entry: "$pano/lib/components/Posts.svelte",
      props: { posts: [] },
      context: () => new Map([["themeSettings", {}]]),
    },
    "Tickets/list": {
      entry: "$pano/lib/components/Tickets.svelte",
      props: { tickets: [ticket(1, "NEW"), ticket(2, "REPLIED", { selected: true }), ticket(3, "CLOSED")] },
    },
    "Tickets/empty": { entry: "$pano/lib/components/Tickets.svelte", props: { tickets: [] } },
    "TicketRow/new": { entry: "$pano/lib/components/TicketRow.svelte", props: { ticket: ticket(1, "NEW") } },
    "TicketRow/closed-selected": {
      entry: "$pano/lib/components/TicketRow.svelte",
      props: { ticket: ticket(2, "CLOSED", { selected: true }) },
    },
    "TicketStatus/default": { entry: "$pano/lib/components/TicketStatus.svelte", props: {} },
    "TicketStatus/new": { entry: "$pano/lib/components/TicketStatus.svelte", props: { status: "NEW" } },
    "TicketStatus/replied": { entry: "$pano/lib/components/TicketStatus.svelte", props: { status: "REPLIED" } },
    "TicketStatus/closed": { entry: "$pano/lib/components/TicketStatus.svelte", props: { status: "CLOSED" } },
    "TicketStatus/unknown": { entry: "$pano/lib/components/TicketStatus.svelte", props: { status: "WHAT" } },
  };
}

/** Renders every case against `root`. */
export async function renderAll(svelteDir, root) {
  const out = {};
  for (const [name, c] of Object.entries(buildCases())) {
    out[name] = await renderPart({
      svelteDir,
      root,
      entry: c.entry,
      props: c.props ?? {},
      slot: c.slot,
      context: c.context ? c.context() : undefined,
    });
  }
  return out;
}
