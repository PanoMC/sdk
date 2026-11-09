import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLicenseRuntime } from "../../kit/license-runtime.js";
import { computeStableFileFingerprint } from "../../../bin/license/file-fingerprint.js";

// The file-integrity check of a premium theme: when the signed token carries `fp`, that is the expected
// fingerprint, so editing a file and re-stamping the unsigned manifest.json no longer passes.

const THEME_ID = "test-theme";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const b64url = (value) => Buffer.from(value).toString("base64url");

function sign(payload) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

const claims = (extra = {}) => ({
  iss: "panomc.com",
  aud: THEME_ID,
  ver: "1.0.0",
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...extra,
});

let root;
let cwd;

const verify = () =>
  createLicenseRuntime({
    PANO_LICENSE_PUBLIC_KEY_BASE64: keyBase64,
    PANO_LICENSE_THEME_ID: THEME_ID,
    PANO_LICENSE_THEME_VERSION: "1.0.0",
    PANO_LICENSE_REQUIRED: true,
  }).verifyLicenseFromEnv();

function setUp({ file, manifestFp, token }) {
  writeFileSync(join(root, "client", "app.js"), file);
  writeFileSync(join(root, ".pano-license.jwt"), token);
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ id: THEME_ID, fileFingerprint: manifestFp }));
}

const fingerprintWith = (file) => {
  writeFileSync(join(root, "client", "app.js"), file);
  return computeStableFileFingerprint(root, ["manifest.json", ".pano-license.jwt"]);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "tc-license-"));
  mkdirSync(join(root, "client"));
  cwd = process.cwd();
  process.chdir(root);
});

afterAll(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

describe("premium theme file fingerprint", () => {
  test("without an fp claim the manifest value is compared (corruption check)", () => {
    const fp = fingerprintWith("one");
    setUp({ file: "one", manifestFp: fp, token: sign(claims()) });
    expect(verify()).not.toBeNull();
  });

  test("the signed fp wins over the manifest", () => {
    const fp = fingerprintWith("one");
    setUp({ file: "one", manifestFp: "0".repeat(64), token: sign(claims({ fp })) });
    expect(verify()).not.toBeNull();
  });

  test("an edited file with a re-stamped manifest fails against the signed fp", () => {
    const fp = fingerprintWith("one");
    const restamped = fingerprintWith("edited");
    setUp({ file: "edited", manifestFp: restamped, token: sign(claims({ fp })) });
    expect(() => verify()).toThrow("theme files have been modified");
  });

  test("a malformed fp claim fails", () => {
    const fp = fingerprintWith("one");
    setUp({ file: "one", manifestFp: fp, token: sign(claims({ fp: "nope" })) });
    expect(() => verify()).toThrow("fp claim is malformed");
  });
});
