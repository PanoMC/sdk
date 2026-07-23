/**
 * ui.js — shared CLI presentation layer for the theme-core commands.
 *
 * Wraps @clack/prompts + picocolors so every command speaks the same visual
 * language (styled intro/outro, spinners, prompts) and shares the TTY/CI
 * detection that keeps sync/check/package safe to run non-interactively.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import pc from "picocolors";

export { clack, pc };

// Re-export the clack primitives the commands reach for, so callers import
// from one place instead of poking at the namespace.
export const {
  intro,
  outro,
  text,
  confirm,
  select,
  spinner,
  cancel,
  isCancel,
  note,
  log,
} = clack;

const binDir = dirname(fileURLToPath(import.meta.url));
export const corePkg = JSON.parse(
  readFileSync(join(binDir, "..", "package.json"), "utf-8"),
);
export const version = corePkg.version;

/**
 * Interactive when we own a real TTY and are not inside CI. Every command that
 * might prompt gates on this — a non-interactive invocation (scripts, CI,
 * postinstall, piped stdin) must never block waiting for input.
 */
export function isInteractive() {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

/**
 * Unwrap a clack prompt result, honoring Ctrl+C: on cancel we print the
 * standard cancel line and exit non-zero so nothing half-completes.
 */
export function cancelGuard(value) {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }
  return value;
}

/** Styled brand header: "pano theme-core vX.Y.Z". */
export function brandIntro() {
  intro(
    `${pc.bgCyan(pc.black(" pano "))} ${pc.bold("theme-core")} ${pc.dim(`v${version}`)}`,
  );
}

/** Docs entry point, referenced by help/new/eject next-steps. */
export const DOCS_URL = "https://panocms.com/docs/theme/getting-started/";
