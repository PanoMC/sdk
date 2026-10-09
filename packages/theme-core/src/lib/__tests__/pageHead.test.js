import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const lib = join(import.meta.dir, "..");
const routes = join(lib, "..", "routes", "plugin-ui");
const read = (...parts) => readFileSync(join(...parts), "utf-8");

// svelte is a peer of the theme (not installed in this repo): use it from the repo, or from the
// vanilla-theme checkout next to it when present. Without any, only the source assertions run.
function findSvelte() {
  for (const from of [import.meta.dir, join(import.meta.dir, "../../../../../../themes/vanilla-theme/package.json")]) {
    try {
      const req = createRequire(from);
      return join(req.resolve("svelte/package.json"), "..");
    } catch {
      // try the next location
    }
  }
  return null;
}

const svelteDir = findSvelte();

describe("page head plumbing (TC-2 / TC-3 wiring)", () => {
  test("MainLayoutView no longer emits the description tag but keeps keywords", () => {
    const source = read(lib, "views", "MainLayoutView.svelte");

    expect(source).not.toMatch(/name\s*=\s*["']description["']/);
    expect(source).toContain('name="keywords"');
  });

  test("meta is lifted to page.data by the plugin page load (load.js) and Layout.svelte", () => {
    for (const file of ["load.js", "Layout.svelte"]) {
      expect(read(routes, file)).toMatch(
        /\["pageTitle", "breadcrumbs", "sidebar", "sidebarProps", "meta"\]/,
      );
    }
  });

  test("AppLayout mounts PageHead with meta, siteInfo, url and the resolved title", () => {
    const source = read(lib, "layouts", "AppLayout.svelte");

    expect(source).toMatch(/<PageHead[\s\S]*?meta=\{\$page\.data\?\.meta\}/);
    expect(source).toContain("siteInfo={$session.siteInfo}");
    expect(source).toContain("url={$page.url}");
    expect(source).toContain("resolvePageTitle($pageTitle, $_).title");
    // before the layout view, so its tags come first
    expect(source.indexOf("<PageHead")).toBeLessThan(source.indexOf("<svelte:component"));
    // the document title honours `raw` through the shared helper
    expect(source).toMatch(/getTitle[\s\S]*resolvePageTitle\(pt, \$_\)/);
  });

  test("Main skips the visible title when hidden and uses the shared helper", () => {
    const source = read(lib, "components", "Main.svelte");
    const part = read(lib, "views", "parts", "Main.svelte");

    expect(source).toContain("resolvePageTitle($pageTitle, $_)");
    expect(part).toContain("!resolvedTitle.hidden");
    expect(source + part).not.toMatch(/\$_\(\$pageTitle/);
  });

  test("PageHead emits the JSON-LD script with a split closing tag", () => {
    const source = read(lib, "components", "PageHead.svelte");

    expect(source).toContain("'</' + 'script>'");
    expect(source).not.toContain("</script>\n  {/if}");
  });
});

describe.skipIf(!svelteDir)("PageHead server render", () => {
  async function renderHead(props) {
    const compiler = await import(join(svelteDir, "src", "compiler", "index.js"));
    const source = read(lib, "components", "PageHead.svelte");
    const { js } = compiler.compile(source, { generate: "server", filename: "PageHead.svelte" });

    // The engine alias points at this checkout; svelte resolves through a symlinked node_modules.
    const code = js.code.replace(
      '"$pano/lib/pageMeta.util.js"',
      JSON.stringify(join(lib, "pageMeta.util.js")),
    );

    const dir = mkdtempSync(join(tmpdir(), "pagehead-"));
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(svelteDir, join(dir, "node_modules", "svelte"), "dir");
    const file = join(dir, "PageHead.mjs");
    writeFileSync(file, code);

    try {
      const { default: Component } = await import(file);
      const { render } = await import(join(dir, "node_modules", "svelte", "src", "server", "index.js"));

      return render(Component, { props }).head;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const siteInfo = {
    websiteName: "My Server",
    websiteDescription: "Site description",
    websiteUrl: "https://pano.example",
  };
  const url = new URL("https://127.0.0.1:3000/store/p");
  const count = (html, needle) => html.split(needle).length - 1;

  test("a page without meta emits exactly one description (the site-wide one) and no optional tags", async () => {
    const head = await renderHead({ meta: undefined, siteInfo, url, title: "Store" });

    expect(count(head, 'name="description"')).toBe(1);
    expect(head).toContain('content="Site description"');
    expect(head).toContain('property="og:title" content="Store"');
    expect(head).toContain('property="og:url" content="https://pano.example/store/p"');
    expect(head).toContain('name="twitter:card" content="summary"');
    expect(head).not.toContain("og:image");
    expect(head).not.toContain("canonical");
    expect(head).not.toContain('name="robots"');
    expect(head).not.toContain("ld+json");
  });

  test("a page with meta emits one description, og:image, canonical, referrer and JSON-LD", async () => {
    const head = await renderHead({
      meta: {
        description: "Buy   the thing",
        image: "/img/a.png",
        imageAlt: "A thing",
        canonical: "/store/p",
        robots: "noindex, evil",
        referrer: "no-referrer",
        type: "product",
        jsonLd: { "@type": "Product", name: "</script><script>alert(1)</script>" },
      },
      siteInfo,
      url,
      title: "Store",
    });

    expect(count(head, 'name="description"')).toBe(1);
    expect(head).toContain('content="Buy the thing"');
    expect(head).toContain('property="og:image" content="https://pano.example/img/a.png"');
    expect(head).toContain('property="og:image:alt" content="A thing"');
    expect(head).toContain('rel="canonical" href="https://pano.example/store/p"');
    expect(head).toContain('name="robots" content="noindex"');
    expect(head).toContain('name="referrer" content="no-referrer"');
    expect(head).toContain('property="og:type" content="product"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');

    // exactly one JSON-LD script and the payload cannot close it early
    expect(count(head, '<script type="application/ld+json">')).toBe(1);
    expect(count(head, "</script>")).toBe(1);
    expect(head).toContain("\\u003c/script>");
  });

  test("meta values are attribute-escaped", async () => {
    const head = await renderHead({
      meta: { description: 'a" onload="alert(1)', title: '"><script>x</script>' },
      siteInfo,
      url,
      title: "T",
    });

    expect(head).not.toContain('onload="alert(1)"');
    expect(head).not.toContain("<script>x</script>");
  });
});
