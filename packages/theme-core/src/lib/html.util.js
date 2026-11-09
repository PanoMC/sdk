import { sanitize } from "@jill64/universal-sanitizer";

/*
 * Rich HTML that panel users write (post bodies, staff ticket replies, the register agreement, translation
 * overrides) goes through sanitizeRichHtml before any {@html}. The allow-list covers what the panel editor
 * (TipTap StarterKit + Image + TextStyleKit) writes, plus common formatting tags older content may hold.
 * Scripts, event handlers, iframes, forms and javascript: links are removed.
 *
 * The server side (SSR) runs sanitize-html, the browser DOMPurify; both get the same lists.
 */

// One comma-joined string, not an array of words: the engine's class scanner (scripts/build-tokens.js) would read
// "h1", "mark", "small" ... as Bootstrap class names and grow the fallback sheet.
const TAGS = (
  "a,abbr,b,blockquote,br,caption,code,col,colgroup,del,div,em,figcaption,figure,h1,h2,h3,h4,h5,h6,hr,i,img,ins," +
  "kbd,li,mark,ol,p,pre,s,small,span,strike,strong,sub,sup,table,tbody,td,tfoot,th,thead,tr,u,ul"
).split(",");

const GLOBAL_ATTRS = ["class", "style", "title"];
const TAG_ATTRS = {
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
};

// Only plain values (no url(), no expressions); the same rules as panel-ui's html-sanitize.util.js.
const STYLE_VALUE = [/^[#a-z0-9\s.,%()-]+$/i];
const FONT_FAMILY = [/^[a-z0-9\s,'"-]+$/i];
const STYLES = {
  ...Object.fromEntries(
    ["color", "background-color", "font-size", "font-weight", "font-style", "line-height", "width", "height"].map(
      (name) => [name, STYLE_VALUE],
    ),
  ),
  "font-family": FONT_FAMILY,
  "text-align": [/^(left|right|center|justify)$/],
  "text-decoration": [/^[a-z\s-]+$/i],
};

const SANITIZE_HTML = {
  allowedTags: TAGS,
  allowedAttributes: {
    "*": GLOBAL_ATTRS,
    ...TAG_ATTRS,
  },
  allowedStyles: { "*": STYLES },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: true,
  disallowedTagsMode: "discard",
};

const DOMPURIFY = {
  ALLOWED_TAGS: TAGS,
  ALLOWED_ATTR: [...new Set([...GLOBAL_ATTRS, ...Object.values(TAG_ATTRS).flat()])],
  ALLOW_DATA_ATTR: false,
};

/**
 * The style attribute with only the declarations STYLES allows (DOMPurify keeps style as is; sanitize-html filters
 * it through allowedStyles). Exported for the test.
 *
 * @param {string} style
 * @returns {string}
 */
export function filterStyle(style) {
  return String(style)
    .split(";")
    .map((part) => {
      const at = part.indexOf(":");
      if (at < 0) return null;
      const name = part.slice(0, at).trim().toLowerCase();
      const value = part.slice(at + 1).trim();
      return STYLES[name]?.some((rule) => rule.test(value)) ? `${name}:${value}` : null;
    })
    .filter(Boolean)
    .join(";");
}

// The hook only acts while sanitizeRichHtml runs, so other DOMPurify users of the same instance are not changed.
let active = false;
let hooked = false;

/** @param {any} purify */
function hook(purify) {
  if (hooked || typeof purify?.addHook !== "function") return;
  hooked = true;
  purify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (!active || data.attrName !== "style") return;
    data.attrValue = filterStyle(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  });
}

/**
 * Removes everything from panel-written HTML that could run script; keeps formatting, links and images.
 * Not a string (null, undefined, a number) yields "" so a missing value renders as nothing.
 *
 * @param {unknown} html
 * @returns {string}
 */
export function sanitizeRichHtml(html) {
  if (typeof html !== "string" || html === "") return "";

  active = true;
  try {
    return sanitize(html, { sanitizeHtml: SANITIZE_HTML, dompurify: DOMPURIFY, hook });
  } finally {
    active = false;
  }
}
