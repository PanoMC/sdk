import { describe, expect, test } from "bun:test";
import { serverDevModeOff } from "../vite-config.js";

describe("serverDevModeOff", () => {
  test("turns Svelte dev mode off for the server compile only", async () => {
    const fn = serverDevModeOff();

    expect(await fn({ compileOptions: { generate: "server", dev: true } })).toEqual({ dev: false });
    expect(await fn({ compileOptions: { generate: "client", dev: true } })).toBeUndefined();
    expect(await fn({ compileOptions: { generate: "server", dev: false } })).toBeUndefined();
  });

  test("the theme's own dynamicCompileOptions still runs and wins", async () => {
    const fn = serverDevModeOff(({ filename }) => (filename.endsWith("X.svelte") ? { dev: true, runes: true } : undefined));

    expect(await fn({ filename: "a/X.svelte", compileOptions: { generate: "server", dev: true } })).toEqual({
      dev: true,
      runes: true,
    });
    expect(await fn({ filename: "a/Y.svelte", compileOptions: { generate: "server", dev: true } })).toEqual({ dev: false });
    expect(await fn({ filename: "a/X.svelte", compileOptions: { generate: "client", dev: true } })).toEqual({
      dev: true,
      runes: true,
    });
  });
});
