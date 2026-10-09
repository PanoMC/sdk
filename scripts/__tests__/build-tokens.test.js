import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postcss from "postcss";
import { TOKENS, PALETTES } from "../../packages/plugin-kit/src/styles/tokens.map.js";
import { OUTPUTS, ROOT, build, compileMain, renderBridge, resolvePalettes } from "../build-tokens.js";

/** The commit right before the token bridge landed: the reference for "vanilla is unchanged". */
const BASE_COMMIT = "6796eec";
const SCSS = ["main", "themes", "custom-bootstrap", "fonts"].map((n) => `${n}.scss`);

const read = (file) => readFileSync(join(ROOT, file), "utf-8");

describe("token table", () => {
  test("has the 34 tokens of doc 03 section 2, unique, each with a bs variable or a Sass expression", () => {
    expect(TOKENS.length).toBe(34);
    expect(new Set(TOKENS.map((t) => t.token)).size).toBe(34);
    for (const t of TOKENS) {
      expect(t.token).toMatch(/^--pano-[a-z-]+$/);
      expect(Boolean(t.bs) !== Boolean(t.sass)).toBe(true);
      if (t.bs) expect(t.bs).toMatch(/^--bs-[a-z-]+$/);
    }
  });
});

describe("generated files", () => {
  const generated = build();

  for (const [name, file] of Object.entries(OUTPUTS)) {
    test(`regenerating gives the committed ${name} file (${file})`, () => {
      expect(generated[file]).toBe(read(file));
    });
  }

  test("the bridge mirrors every token", () => {
    const bridge = renderBridge();
    for (const t of TOKENS) expect(bridge).toContain(`${t.token}: ${t.bs ? `var(${t.bs})` : `#{${t.sass}}`};`);
  });

  test("the literal defaults hold every token in each of the six palette blocks, inside @layer pano-defaults", () => {
    const root = postcss.parse(read(OUTPUTS.literals));
    const layers = root.nodes.filter((n) => n.type === "atrule" && n.name === "layer");
    expect(layers.length).toBe(1);
    expect(layers[0].params).toBe("pano-defaults");

    const blocks = layers[0].nodes.filter((n) => n.type === "rule");
    expect(blocks.length).toBe(6);
    blocks.forEach((block, i) => {
      expect(block.selector).toContain(`[data-bs-theme='${PALETTES[i]}']`);
      const decls = new Map();
      block.each((d) => d.type === "decl" && decls.set(d.prop, d.value));
      expect([...decls.keys()]).toEqual(TOKENS.map((t) => t.token));
      for (const value of decls.values()) {
        expect(value).not.toBe("");
        expect(value).not.toContain("var(");
        expect(value).not.toContain("#{");
      }
    });
    expect(blocks[0].selector).toContain(":root");
  });

  test("palette values follow the cascade: palettes differ, on-* come from define-theme", () => {
    const p = resolvePalettes(compileMain());
    expect(p.light["--pano-color-bg"]).toBe("#fff");
    expect(p.dark["--pano-color-bg"]).toBe("#0a1931");
    expect(p.copper["--pano-color-primary"]).toBe("#b87333");
    expect(p.emerald["--pano-color-primary"]).toBe("#10b981");
    expect(p.midnight["--pano-color-secondary"]).toBe("#ec4899");
    expect(p.crimson["--pano-color-primary"]).toBe("#ef4444");
    for (const name of ["copper", "emerald", "midnight", "crimson"]) {
      expect(p[name]["--pano-color-on-primary"]).toBe("#000");
      expect(p[name]["--pano-color-on-secondary"]).toBe("#000");
    }
    expect(p.light["--pano-color-on-primary"]).toBe("#fff");
  });

  test("a theme's own Sass tokens reach the bridge", () => {
    const p = resolvePalettes(compileMain({ head: "$primary: #ffeb3b;\n$spacer: 2rem;\n$headings-font-family: Georgia;\n" }));
    expect(p.light["--pano-color-primary"]).toBe("#ffeb3b");
    expect(p.light["--pano-color-on-primary"]).toBe("#000");
    expect(p.light["--pano-space"]).toBe("2rem");
    expect(p.light["--pano-font-heading"]).toBe("Georgia");
  });

  test("the base sheet has no --pano-* variable and none of the literal-colour rules", () => {
    const base = read(OUTPUTS.base);
    expect(base).not.toContain("--pano-");
    expect(base).not.toContain("border: 1.5px solid rgba(255, 255, 255, 0.1) !important");
    expect(base).not.toMatch(/\.bg-primary-subtle\s*\{[^}]*rgba\(4, 67, 137/);
    expect(base).not.toMatch(/\[data-bs-theme=copper\] \.btn-primary/);
    expect(base).toMatch(/^\[data-bs-theme=copper\] \{/m);
    expect(base).toContain("--bs-border-style: solid");
  });
});

describe("vanilla's compiled CSS", () => {
  const git = (...args) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
  let hasBase = true;
  try {
    git("cat-file", "-e", `${BASE_COMMIT}^{commit}`);
  } catch {
    hasBase = false; // shallow clone: the reference commit is not there
  }

  (hasBase ? test : test.skip)("is byte-identical to before apart from the bridge block, the on-* pair and the two var() fixes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pano-tokens-old-"));
    try {
      mkdirSync(dir, { recursive: true });
      for (const f of SCSS) writeFileSync(join(dir, f), git("show", `${BASE_COMMIT}:packages/sdk/core/scss/${f}`));
      const before = compileMain({ scssDir: dir });
      const after = compileMain();

      const marker = "/* pano-tokens: bridge */";
      const at = after.indexOf(marker);
      expect(at).toBeGreaterThan(0);
      const bridgeBlock = after.slice(at);
      expect(bridgeBlock).toContain("--pano-color-bg: var(--bs-body-bg);");

      const stripped = after
        .slice(0, at)
        .replace(/\n {2}--pano-color-on-(primary|secondary): #000;/g, "")
        // deliberate change: dark outline-primary buttons use the text-emphasis tone (readable on dark)
        .replace(/\n\[data-bs-theme=dark\] \.btn-outline-primary, [^{]*\{[^}]*\}/, "");
      const reference = before.replace("var(--pano-primary)", "var(--bs-primary)").replace("var(--pano-light)", "var(--bs-tertiary-bg)");
      expect(stripped.trimEnd()).toBe(reference.trimEnd());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
