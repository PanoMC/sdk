// Pure route map (doc 01 section 9). Canonical paths never change in route files or in plugin
// registrations; a theme can rename or disable them in `theme.config.js` (`routes.rename`,
// `routes.disable`). This module only maps strings: no framework imports, no state.
//
// Patterns use the `[param]` syntax of RouteMatcher (`/store/[slug]`, and a final `[...rest]`).
// Both sides of a rename must name the same params. Params are carried over as the raw path
// segments, so percent-encoding is never touched.

/**
 * @typedef {{ rename?: Record<string, string>, disable?: string[] }} RouteMapConfig
 * @typedef {{
 *   toCanonical: (pathname: string) => string | null,
 *   toPublic: (canonicalPath: string) => string,
 *   isRenamedAway: (pathname: string) => boolean,
 * }} RouteMap
 */

const PARAM = /^\[(\.\.\.)?([A-Za-z_$][\w$]*)\]$/;

/**
 * @typedef {{ literal: string } | { param: string } | { rest: string }} Segment
 * @typedef {{ source: string, segments: Segment[], names: string[], score: number[] }} Pattern
 */

/**
 * @param {string} source
 * @returns {Pattern}
 */
function parsePattern(source) {
  if (typeof source !== "string" || !source.startsWith("/") || source.startsWith("//")) {
    throw new Error(`Invalid route pattern ${JSON.stringify(source)}: a route starts with a single "/".`);
  }
  if (/[?#]/.test(source)) {
    throw new Error(`Invalid route pattern "${source}": no query string or hash.`);
  }

  const parts = source.split("/").filter(Boolean);
  /** @type {Segment[]} */
  const segments = [];
  /** @type {string[]} */
  const names = [];

  parts.forEach((part, index) => {
    const match = PARAM.exec(part);

    if (!match) {
      if (part.includes("[") || part.includes("]")) {
        throw new Error(`Invalid route pattern "${source}": unsupported segment "${part}".`);
      }
      segments.push({ literal: part });
      return;
    }

    const [, dots, name] = match;

    if (names.includes(name)) {
      throw new Error(`Invalid route pattern "${source}": param "${name}" is used twice.`);
    }
    names.push(name);

    if (dots) {
      if (index !== parts.length - 1) {
        throw new Error(`Invalid route pattern "${source}": a [...${name}] segment must be the last one.`);
      }
      segments.push({ rest: name });
    } else {
      segments.push({ param: name });
    }
  });

  // Specificity per segment (literal 2, param 1, rest 0); compared lexicographically.
  const score = segments.map((segment) => ("literal" in segment ? 2 : "param" in segment ? 1 : 0));

  return { source, segments, names, score };
}

/**
 * @param {Pattern} a
 * @param {Pattern} b
 */
function compareSpecificity(a, b) {
  const length = Math.max(a.score.length, b.score.length);

  for (let i = 0; i < length; i++) {
    const left = a.score[i] ?? -1;
    const right = b.score[i] ?? -1;

    if (left !== right) {
      return right - left;
    }
  }

  return 0;
}

/**
 * Splits `/a/b/?x=1#y` into the path part and the untouched suffix.
 * @param {string} value
 */
function splitSuffix(value) {
  const index = value.search(/[?#]/);

  return index === -1 ? [value, ""] : [value.slice(0, index), value.slice(index)];
}

/**
 * Match a path against a pattern.
 * @param {Pattern} pattern
 * @param {string[]} parts  non-empty path segments
 * @returns {Record<string, string> | null}
 */
function matchPattern(pattern, parts) {
  /** @type {Record<string, string>} */
  const params = {};
  const { segments } = pattern;
  const last = segments[segments.length - 1];
  const hasRest = last !== undefined && "rest" in last;
  const fixed = hasRest ? segments.length - 1 : segments.length;

  if (hasRest ? parts.length < fixed : parts.length !== fixed) {
    return null;
  }

  for (let i = 0; i < fixed; i++) {
    const segment = segments[i];

    if ("literal" in segment) {
      if (segment.literal !== parts[i]) {
        return null;
      }
    } else if ("param" in segment) {
      params[segment.param] = parts[i];
    }
  }

  if (hasRest) {
    params[/** @type {{ rest: string }} */ (last).rest] = parts.slice(fixed).join("/");
  }

  return params;
}

/**
 * @param {Pattern} pattern
 * @param {Record<string, string>} params
 */
function fillPattern(pattern, params) {
  const parts = [];

  for (const segment of pattern.segments) {
    if ("literal" in segment) {
      parts.push(segment.literal);
    } else {
      const value = params["param" in segment ? segment.param : segment.rest];

      if (value !== "") {
        parts.push(value);
      }
    }
  }

  return "/" + parts.join("/");
}

/**
 * @param {Pattern[]} patterns  sorted, most specific first
 * @param {string} path
 * @returns {{ pattern: Pattern, params: Record<string, string>, trailingSlash: boolean, suffix: string } | null}
 */
function findPattern(patterns, path) {
  const [pathOnly, suffix] = splitSuffix(path);

  if (!pathOnly.startsWith("/") || pathOnly.startsWith("//")) {
    return null;
  }

  const parts = pathOnly.split("/").filter(Boolean);
  const trailingSlash = parts.length > 0 && pathOnly.endsWith("/");

  for (const pattern of patterns) {
    const params = matchPattern(pattern, parts);

    if (params) {
      return { pattern, params, trailingSlash, suffix };
    }
  }

  return null;
}

/**
 * @param {{ pattern: Pattern, params: Record<string, string>, trailingSlash: boolean, suffix: string }} hit
 * @param {Pattern} target
 */
function rewrite(hit, target) {
  const path = fillPattern(target, hit.params);

  return path + (hit.trailingSlash && path !== "/" ? "/" : "") + hit.suffix;
}

/**
 * @param {RouteMapConfig} [config]
 * @returns {RouteMap}
 */
export function createRouteMap({ rename = {}, disable = [] } = {}) {
  /** @type {{ canonical: Pattern, public: Pattern }[]} */
  const renames = [];
  const publicSeen = new Map();

  for (const [canonicalSource, publicSource] of Object.entries(rename ?? {})) {
    const canonical = parsePattern(canonicalSource);
    const publicPattern = parsePattern(publicSource);

    const same =
      canonical.names.length === publicPattern.names.length &&
      canonical.names.every((name) => publicPattern.names.includes(name));

    if (!same) {
      throw new Error(
        `Route rename "${canonicalSource}" -> "${publicSource}": both sides need the same params ` +
          `([${canonical.names.join(", ")}] vs [${publicPattern.names.join(", ")}]).`,
      );
    }

    // A rest param must stay a rest param (and a plain param a plain param), otherwise the
    // reverse mapping would merge or split segments.
    const kinds = (pattern) => pattern.segments.flatMap((s) => ("param" in s ? [`p:${s.param}`] : "rest" in s ? [`r:${s.rest}`] : []));
    const left = kinds(canonical).sort().join(",");
    const right = kinds(publicPattern).sort().join(",");

    if (left !== right) {
      throw new Error(`Route rename "${canonicalSource}" -> "${publicSource}": a [...rest] param must be a [...rest] param on both sides.`);
    }

    // `/a/[x]` and `/a/[y]` are the same public shape.
    const shape = publicPattern.segments.map((s) => ("literal" in s ? s.literal : "param" in s ? "*" : "**")).join("/");

    if (publicSeen.has(shape)) {
      throw new Error(`Route rename: "${publicSource}" is the public path of both "${publicSeen.get(shape)}" and "${canonicalSource}".`);
    }
    publicSeen.set(shape, canonicalSource);

    renames.push({ canonical, public: publicPattern });
  }

  const disabled = (disable ?? []).map(parsePattern).sort(compareSpecificity);

  const byPublic = renames.map((r) => r.public).sort(compareSpecificity);
  const byCanonical = renames.map((r) => r.canonical).sort(compareSpecificity);
  const canonicalOfPublic = new Map(renames.map((r) => [r.public, r.canonical]));
  const publicOfCanonical = new Map(renames.map((r) => [r.canonical, r.public]));

  /** @param {string} path */
  function mapToCanonical(path) {
    const hit = findPattern(byPublic, path);

    return hit ? rewrite(hit, /** @type {Pattern} */ (canonicalOfPublic.get(hit.pattern))) : path;
  }

  return {
    /**
     * Public pathname -> canonical pathname. `null` = the route is disabled. A canonical path
     * that was renamed away is returned unchanged (the server answers it with a 308 and the
     * client keeps resolving it).
     * @param {string} pathname
     * @returns {string | null}
     */
    toCanonical(pathname) {
      const canonical = mapToCanonical(pathname);

      return findPattern(disabled, canonical) ? null : canonical;
    },

    /**
     * Canonical path -> public path. Anything that is not a site path (absolute URLs, `#top`,
     * `mailto:`) and every path without a rename comes back as given; query and hash are kept.
     * @param {string} canonicalPath
     * @returns {string}
     */
    toPublic(canonicalPath) {
      const hit = findPattern(byCanonical, canonicalPath);

      return hit ? rewrite(hit, /** @type {Pattern} */ (publicOfCanonical.get(hit.pattern))) : canonicalPath;
    },

    /**
     * True for a canonical path whose public path is different (and which is not itself a
     * public path of another rename).
     * @param {string} pathname
     * @returns {boolean}
     */
    isRenamedAway(pathname) {
      if (!findPattern(byCanonical, pathname)) {
        return false;
      }

      return !findPattern(byPublic, pathname);
    },
  };
}
