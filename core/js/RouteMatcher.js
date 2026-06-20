/**
 * Simple route matcher that supports literals, dynamic segments [param],
 * catch-all segments [...param], and basic regex patterns.
 */
export class RouteMatcher {
  /**
   * Matches a path against a pattern.
   * @param {string} pattern - The route pattern (e.g., '/announcements/[id]')
   * @param {string} path - The actual path (e.g., '/announcements/123')
   * @returns {object|null} - Params object if matched, null otherwise
   */
  static match(pattern, path) {
    // Normalize path: remove query params and trailing slash
    const [pathOnly] = path.split('?');
    const normalizedPath = pathOnly === '/' ? '/' : pathOnly.replace(/\/$/, '');
    const normalizedPattern = pattern === '/' ? '/' : pattern.replace(/\/$/, '');

    // 1. Literal match
    if (normalizedPattern === normalizedPath) {
      return {};
    }

    // 2. Regex match
    // Regex must be explicitly opted in with a `re:` prefix — we must NOT infer "this is a
    // regex" from a leading/trailing slash, since a normal plugin path with a trailing slash
    // (e.g. `/news/`) would otherwise be reinterpreted as an UNANCHORED regex and silently
    // hijack unrelated routes. The body is anchored as `^(?:...)$` so it can't partial-match.
    if (pattern.startsWith('re:')) {
      try {
        const regex = new RegExp(`^(?:${pattern.slice(3)})$`);
        const match = normalizedPath.match(regex);
        if (match) {
          return match.groups || {};
        }
      } catch (e) {
        console.error('Invalid regex pattern:', pattern, e);
      }
    }

    // 3. Segment-based match (SvelteKit style)
    const patternSegments = normalizedPattern.split('/').filter(Boolean);
    const pathSegments = normalizedPath.split('/').filter(Boolean);

    const params = {};

    // Check for catch-all [...param]
    const catchAllIndex = patternSegments.findIndex((s) => s.startsWith('[...') && s.endsWith(']'));

    if (catchAllIndex !== -1) {
      // SvelteKit only allows a rest param as the FINAL segment. A catch-all that isn't last
      // would greedily absorb every trailing segment and ignore the pattern's suffix, so a
      // pattern like `/[...rest]/edit` would wrongly match `/a/b/c`. Reject it outright.
      if (catchAllIndex !== patternSegments.length - 1) return null;

      // Logic for catch-all
      if (pathSegments.length < catchAllIndex) return null;

      for (let i = 0; i < catchAllIndex; i++) {
        if (!this.segmentsMatch(patternSegments[i], pathSegments[i], params)) {
          return null;
        }
      }

      const paramName = patternSegments[catchAllIndex].slice(4, -1);
      params[paramName] = pathSegments.slice(catchAllIndex).join('/');
      return params;
    }

    // Normal segment match
    if (patternSegments.length !== pathSegments.length) {
      return null;
    }

    for (let i = 0; i < patternSegments.length; i++) {
      if (!this.segmentsMatch(patternSegments[i], pathSegments[i], params)) {
        return null;
      }
    }

    return params;
  }

  static segmentsMatch(patternSegment, pathSegment, params) {
    if (patternSegment.startsWith('[') && patternSegment.endsWith(']')) {
      const paramName = patternSegment.slice(1, -1);
      params[paramName] = pathSegment;
      return true;
    }
    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1);
      params[paramName] = pathSegment;
      return true;
    }
    return patternSegment === pathSegment;
  }
}

/**
 * Canonical form of a route key/path used for the exact-match fast path: query stripped and a
 * single trailing slash removed (but `/` preserved). Used at BOTH registration and lookup so
 * `/foo` and `/foo/` collapse to one entry and the exact-match map lookup always hits instead
 * of falling through to the slower (and buggier) regex/segment branch.
 * @param {string} path
 * @returns {string}
 */
export function canonicalizeRouteKey(path) {
  const [pathOnly] = String(path).split('?');
  return pathOnly === '/' ? '/' : pathOnly.replace(/\/$/, '');
}

/**
 * Finds a registered page matching the given path.
 * @param {Object} registeredPages - Map of patterns to page objects
 * @param {string} path - The path to match
 * @returns {Object|null} - The matching page object with params, or null
 */
export function findMatch(registeredPages, path) {
  // First, try exact match for performance
  const normalizedPath = canonicalizeRouteKey(path);

  if (registeredPages[normalizedPath]) {
    return { ...registeredPages[normalizedPath], params: {} };
  }

  // Then, try more complex matches
  for (const pattern in registeredPages) {
    const params = RouteMatcher.match(pattern, path);
    if (params) {
      return { ...registeredPages[pattern], params };
    }
  }

  return null;
}
