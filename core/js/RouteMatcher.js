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
    // If pattern starts and ends with /, treat as regex
    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      try {
        const regex = new RegExp(pattern.slice(1, -1));
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
 * Finds a registered page matching the given path.
 * @param {Object} registeredPages - Map of patterns to page objects
 * @param {string} path - The path to match
 * @returns {Object|null} - The matching page object with params, or null
 */
export function findMatch(registeredPages, path) {
  // First, try exact match for performance
  const [pathOnly] = path.split('?');
  const normalizedPath = pathOnly === '/' ? '/' : pathOnly.replace(/\/$/, '');

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
