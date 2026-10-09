import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PACKAGES, stampInternal, versionFor } from "../set-version.js";

describe("versionFor", () => {
  test("every package but sdk gets the release version", () => {
    for (const name of PACKAGES.filter((n) => n !== "sdk")) {
      expect(versionFor(name, "1.4.0", "2.0.0")).toBe("1.4.0");
      expect(versionFor(name, "1.4.0-dev.7", "2.0.0")).toBe("1.4.0-dev.7");
    }
  });

  test("sdk is lifted to the line while the train is below it, keeping the prerelease suffix", () => {
    expect(versionFor("sdk", "1.4.0", "2.0.0")).toBe("2.0.0");
    expect(versionFor("sdk", "1.0.0-dev.12", "2.0.0")).toBe("2.0.0-dev.12");
  });

  test("sdk follows the train once it reaches the line", () => {
    expect(versionFor("sdk", "2.0.0", "2.0.0")).toBe("2.0.0");
    expect(versionFor("sdk", "2.3.1", "2.0.0")).toBe("2.3.1");
    expect(versionFor("sdk", "3.0.0-dev.1", "2.0.0")).toBe("3.0.0-dev.1");
  });

  test("no sdkLine: sdk is version-locked like the rest", () => {
    expect(versionFor("sdk", "1.4.0", undefined)).toBe("1.4.0");
  });

  test("a malformed line or version is an error", () => {
    expect(() => versionFor("sdk", "1.4.0", "two")).toThrow();
    expect(() => versionFor("sdk", "latest", "2.0.0")).toThrow();
  });
});

describe("the script", () => {
  test("stamps the files: sdk 2.0.0, the others the release version", () => {
    const root = mkdtempSync(join(tmpdir(), "set-version-"));

    try {
      for (const name of PACKAGES) {
        mkdirSync(join(root, "packages", name), { recursive: true });
        writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ name: `@panomc/${name}`, version: "0.0.0-development", ...(name === "sdk" ? { sdkLine: "2.0.0" } : {}) }));
      }

      const proc = Bun.spawnSync([process.execPath, join(import.meta.dir, "..", "set-version.js"), "1.2.3-dev.4"], { cwd: root, stdout: "pipe", stderr: "pipe" });

      expect(proc.exitCode).toBe(0);

      const version = (name) => JSON.parse(readFileSync(join(root, "packages", name, "package.json"), "utf8")).version;

      expect(version("sdk")).toBe("2.0.0-dev.4");
      expect(version("theme-core")).toBe("1.2.3-dev.4");
      expect(version("plugin-kit")).toBe("1.2.3-dev.4");
      expect(JSON.parse(readFileSync(join(root, "packages/sdk/package.json"), "utf8")).sdkLine).toBe("2.0.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("stampInternal", () => {
  const versions = { "@panomc/sdk": "2.0.0-dev.62", "@panomc/client": "1.0.0-dev.62" };

  test("dependencies get the exact version, peers a caret range, third parties are left alone", () => {
    const data = stampInternal(
      {
        dependencies: { "@panomc/client": "workspace:*", svelte: "5.1.0" },
        peerDependencies: { "@panomc/sdk": "*", svelte: "*" },
        devDependencies: { "@panomc/sdk": "workspace:*", rollup: "^4.0.0" },
      },
      versions,
    );

    expect(data.dependencies).toEqual({ "@panomc/client": "1.0.0-dev.62", svelte: "5.1.0" });
    expect(data.peerDependencies).toEqual({ "@panomc/sdk": "^2.0.0-dev.62", svelte: "*" });
    expect(data.devDependencies).toEqual({ "@panomc/sdk": "2.0.0-dev.62", rollup: "^4.0.0" });
  });

  test("the real package.json files: after set-version nothing is a workspace: or placeholder reference", () => {
    const repo = join(import.meta.dir, "..", "..");
    const root = mkdtempSync(join(tmpdir(), "set-version-real-"));

    try {
      for (const name of PACKAGES) {
        mkdirSync(join(root, "packages", name), { recursive: true });
        writeFileSync(join(root, "packages", name, "package.json"), readFileSync(join(repo, "packages", name, "package.json")));
      }

      const proc = Bun.spawnSync([process.execPath, join(repo, "scripts", "set-version.js"), "1.0.0-dev.62"], { cwd: root, stdout: "pipe", stderr: "pipe" });

      expect(proc.exitCode).toBe(0);

      for (const name of PACKAGES) {
        const text = readFileSync(join(root, "packages", name, "package.json"), "utf8");

        expect(text).not.toContain("workspace:");
        expect(text).not.toContain("0.0.0-development");
      }

      const kit = JSON.parse(readFileSync(join(root, "packages/plugin-kit/package.json"), "utf8"));

      expect(kit.dependencies["@panomc/client-gen"]).toBe("1.0.0-dev.62");
      expect(kit.peerDependencies["@panomc/sdk"]).toBe("^2.0.0-dev.62");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
