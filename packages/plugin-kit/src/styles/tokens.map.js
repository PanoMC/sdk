/**
 * The 34 `--pano-*` design tokens (doc 03 section 2). Single source of truth: the Sass bridge, the
 * literal-defaults sheet and the fallback stylesheet are all generated from this table by
 * `scripts/build-tokens.js`.
 *
 * @typedef {object} PanoToken
 * @property {string} token   the CSS custom property, e.g. `--pano-color-bg`
 * @property {string|null} bs the Bootstrap CSS variable it mirrors, or null when Bootstrap has none
 * @property {string} [sass]  Sass expression used when `bs` is null
 * @property {boolean} [low]  declare with zero specificity (`:where()`), so a palette block that sets
 *                            the same token (the `on-*` pair in `define-theme`) wins over the bridge
 */

/** @type {PanoToken[]} */
export const TOKENS = [
  { token: "--pano-color-bg", bs: "--bs-body-bg" },
  { token: "--pano-color-surface", bs: "--bs-secondary-bg" },
  { token: "--pano-color-surface-raised", bs: "--bs-tertiary-bg" },
  { token: "--pano-color-text", bs: "--bs-body-color" },
  { token: "--pano-color-text-muted", bs: "--bs-secondary-color" },
  { token: "--pano-color-text-subtle", bs: "--bs-tertiary-color" },
  { token: "--pano-color-heading", bs: "--bs-emphasis-color" },
  { token: "--pano-color-border", bs: "--bs-border-color" },
  { token: "--pano-color-primary", bs: "--bs-primary" },
  { token: "--pano-color-secondary", bs: "--bs-secondary" },
  { token: "--pano-color-success", bs: "--bs-success" },
  { token: "--pano-color-danger", bs: "--bs-danger" },
  { token: "--pano-color-warning", bs: "--bs-warning" },
  { token: "--pano-color-info", bs: "--bs-info" },
  { token: "--pano-color-link", bs: "--bs-link-color" },
  { token: "--pano-color-link-hover", bs: "--bs-link-hover-color" },
  { token: "--pano-color-on-primary", bs: null, sass: "color-contrast($primary)", low: true },
  { token: "--pano-color-on-secondary", bs: null, sass: "color-contrast($secondary)", low: true },
  { token: "--pano-radius", bs: "--bs-border-radius" },
  { token: "--pano-radius-sm", bs: "--bs-border-radius-sm" },
  { token: "--pano-radius-lg", bs: "--bs-border-radius-lg" },
  { token: "--pano-radius-pill", bs: "--bs-border-radius-pill" },
  { token: "--pano-border-width", bs: "--bs-border-width" },
  { token: "--pano-shadow-sm", bs: "--bs-box-shadow-sm" },
  { token: "--pano-shadow", bs: "--bs-box-shadow" },
  { token: "--pano-shadow-lg", bs: "--bs-box-shadow-lg" },
  { token: "--pano-font-body", bs: "--bs-body-font-family" },
  { token: "--pano-font-heading", bs: null, sass: "if($headings-font-family, $headings-font-family, inherit)" },
  { token: "--pano-font-mono", bs: "--bs-font-monospace" },
  { token: "--pano-font-size", bs: "--bs-body-font-size" },
  { token: "--pano-font-weight", bs: "--bs-body-font-weight" },
  { token: "--pano-font-weight-bold", bs: null, sass: "$font-weight-bold" },
  { token: "--pano-line-height", bs: "--bs-body-line-height" },
  { token: "--pano-space", bs: null, sass: "$spacer" },
];

/** The six palettes, in output order. `light` also owns `:root`. */
export const PALETTES = ["light", "dark", "copper", "emerald", "midnight", "crimson"];
