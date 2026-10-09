import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { diffSection, readLock, writeLockSection } from "../../lock.js";

const dirs = [];
const root = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kit-lock-"));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

const card = (extra = {}) => ({
  contract: 2,
  props: { product: { required: true }, settings: { required: false } },
  slots: [],
  hooks: [],
  ...extra,
});

describe("lock file", () => {
  test("a missing file reads as an empty lock", () => {
    expect(readLock(root())).toEqual({ format: 1 });
  });

  test("sections are written sorted, kept apart, and unchanged content is not rewritten", () => {
    const dir = root();
    expect(writeLockSection(dir, "views", { "b:B": { contract: 1 }, "a:A": { contract: 1 } })).toBe(true);
    expect(writeLockSection(dir, "controllers", { "a/x": { version: 1, state: [], actions: [] } })).toBe(true);
    expect(writeLockSection(dir, "views", { "a:A": { contract: 1 }, "b:B": { contract: 1 } })).toBe(false);

    const text = fs.readFileSync(path.join(dir, "pano-plugin.lock.json"), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(["controllers", "format", "views"]);
    expect(Object.keys(readLock(dir).views)).toEqual(["a:A", "b:B"]);
  });

  test("malformed JSON names the file and the fix", () => {
    const dir = root();
    fs.writeFileSync(path.join(dir, "pano-plugin.lock.json"), "{ nope");
    expect(() => readLock(dir)).toThrow(/pano-plugin\.lock\.json is not valid JSON.*delete it/);
  });
});

describe("diffSection views", () => {
  test("no previous section: changed, nothing breaking", () => {
    expect(diffSection("views", null, { "market:ProductCard": card() })).toEqual({ changed: true, breaking: [] });
  });

  test("identical section is unchanged", () => {
    expect(diffSection("views", { "market:ProductCard": card() }, { "market:ProductCard": card() })).toEqual({
      changed: false,
      breaking: [],
    });
  });

  test("a removed prop without a raised contract is breaking, with the doc 01 message", () => {
    const next = card({ props: { product: { required: true } } });
    expect(diffSection("views", { "market:ProductCard": card() }, { "market:ProductCard": next }).breaking).toEqual([
      'market:ProductCard: prop "settings" removed — set contract: 3 in ProductCard.svelte (never published? delete pano-plugin.lock.json)',
    ]);
  });

  test("raising the contract makes the same change legal", () => {
    const next = card({ contract: 3, props: { product: { required: true } } });
    const diff = diffSection("views", { "market:ProductCard": card() }, { "market:ProductCard": next });
    expect(diff).toEqual({ changed: true, breaking: [] });
  });

  test("a required prop added, slots changed and a removed class are breaking; an optional prop is not", () => {
    const next = card({
      props: { product: { required: true }, settings: { required: false }, extra: { required: true }, nice: { required: false } },
      slots: ["market:card:footer"],
    });
    const messages = diffSection("views", { "market:ProductCard": card() }, { "market:ProductCard": next }).breaking;
    expect(messages.length).toBe(2);
    expect(messages[0]).toContain('required prop "extra" added');
    expect(messages[1]).toContain("slots changed");

    const withClass = diffSection(
      "views",
      { "market:ProductCard": card({ classes: ["market-product-card", "market-product-card__title"] }) },
      { "market:ProductCard": card({ classes: ["market-product-card"] }) },
    );
    expect(withClass.breaking).toEqual([expect.stringContaining("class market-product-card__title removed")]);

    const optional = card({ props: { product: { required: true }, settings: { required: false }, nice: { required: false } } });
    expect(diffSection("views", { "market:ProductCard": card() }, { "market:ProductCard": optional })).toEqual({
      changed: true,
      breaking: [],
    });
  });

  test("a deleted or a new view is never breaking", () => {
    expect(diffSection("views", { "a:Old": card() }, { "a:New": card() })).toEqual({ changed: true, breaking: [] });
  });
});

describe("diffSection controllers", () => {
  const cart = (extra = {}) => ({ version: 1, state: ["lines", "count"], actions: ["add", "retry"], ...extra });

  test("a removed action without a raised version is breaking", () => {
    const diff = diffSection("controllers", { "market/cart": cart() }, { "market/cart": cart({ actions: ["add"] }) });
    expect(diff.breaking).toEqual(["market/cart: action 'retry' removed — set version: 2 in src/theme/controllers/cart.js"]);
  });

  test("a removed state key is breaking; added keys only update the lock", () => {
    const removed = diffSection("controllers", { "market/cart": cart() }, { "market/cart": cart({ state: ["lines"] }) });
    expect(removed.breaking).toEqual([expect.stringContaining("state 'count' removed")]);

    const added = diffSection("controllers", { "market/cart": cart() }, { "market/cart": cart({ actions: ["add", "retry", "clear"] }) });
    expect(added).toEqual({ changed: true, breaking: [] });
  });

  test("a raised version allows the removal", () => {
    const diff = diffSection("controllers", { "market/cart": cart() }, { "market/cart": cart({ version: 2, actions: ["add"] }) });
    expect(diff.breaking).toEqual([]);
  });
});
