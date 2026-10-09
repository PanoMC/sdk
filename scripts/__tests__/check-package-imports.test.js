import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bareSpecifiers, check, packageName } from "../check-package-imports.js";

describe("bareSpecifiers", () => {
  test("finds static, dynamic and re-export imports, not comments or code-generator strings", () => {
    const source = [
      `import a from "alpha";`,
      `import { b } from '@scope/beta/sub';`,
      `export * from "gamma";`,
      `const d = await import("delta");`,
      `// import x from "commented"`,
      `/* import y from "blocked" */`,
      "const t = `import z from \"templated\"`;",
      `import local from "./local.js";`,
      `import fs from "node:fs";`,
      `import path from "path";`,
    ].join("\n");

    expect(bareSpecifiers(source).sort()).toEqual(["@scope/beta/sub", "alpha", "delta", "gamma"]);
  });

  test("packageName", () => {
    expect(packageName("@scope/beta/sub")).toBe("@scope/beta");
    expect(packageName("alpha/x")).toBe("alpha");
  });
});

describe("check", () => {
  test("flags an undeclared import and a relative import that leaves the package", () => {
    const root = mkdtempSync(join(tmpdir(), "check-imports-"));

    try {
      mkdirSync(join(root, "packages/a/src"), { recursive: true });
      mkdirSync(join(root, "packages/b/src"), { recursive: true });
      writeFileSync(join(root, "packages/a/package.json"), JSON.stringify({ name: "@x/a", files: ["src"], dependencies: { ok: "1" }, devDependencies: { dev: "1" } }));
      writeFileSync(join(root, "packages/a/src/index.js"), `import "ok";\nimport "dev";\nimport "missing";\nimport "../../b/src/x.js";\n`);
      writeFileSync(join(root, "packages/b/package.json"), JSON.stringify({ name: "@x/b", files: ["src"], peerDependencies: { ok: "*" } }));
      writeFileSync(join(root, "packages/b/src/index.js"), `import "ok";\nimport "@x/b";\n`);

      const problems = check(root);

      expect(problems).toHaveLength(3);
      expect(problems.join("\n")).toContain(`imports "dev"`);
      expect(problems.join("\n")).toContain(`imports "missing"`);
      expect(problems.join("\n")).toContain("leaves the package folder");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the real packages declare everything they ship an import of", () => {
    expect(check(join(import.meta.dir, "..", ".."))).toEqual([]);
  });
});
