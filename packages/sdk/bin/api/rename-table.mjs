// The core path renames of doc 04 section 1 (kebab-case normalisation) plus the addon and plugin-zip moves.
// Paths are written in today's form relative to /api (so panel paths keep their /panel segment).
import { escapeRe } from './util.mjs';

/** @type {ReadonlyArray<readonly [string, string]>} old prefix -> new prefix, matched per segment */
export const CORE_RENAMES = [
  ['/siteInfo', '/site-info'],
  ['/websiteLogo', '/website-logo'],
  ['/visitorVisit', '/visitor-visit'],
  ['/registerAgreement', '/register-agreement'],
  ['/auth/renewPassword', '/auth/renew-password'],
  ['/auth/resetPassword', '/auth/reset-password'],
  ['/auth/verifyEmail', '/auth/verify-email'],
  ['/auth/verifyLinkCode', '/auth/verify-link-code'],
  ['/auth/verifyNewEmail', '/auth/verify-new-email'],
  ['/profile/changeEmail', '/profile/change-email'],
  ['/profile/resetPassword', '/profile/reset-password'],
  ['/notifications/quick/markAsRead', '/notifications/quick/mark-as-read'],
  ['/post/thumbnail/:filename', '/posts/thumbnails/:filename'],
  ['/ticket/categories', '/ticket-categories'],
  ['/panel/plugins', '/panel/addons'],
  ['/plugins/:pluginId/resources/plugin-ui.zip', '/plugins/:pluginId/_/ui.zip'],
];

/** @param {string} p */
export const segments = (p) => p.split('/').filter((s) => s.length > 0);

/**
 * Does a (possibly template-holed) path segment fit a route segment?
 * A route parameter (`:id`) fits anything; `${...}` holes fit any text.
 * @param {string} lit @param {string} pat
 */
export function segMatch(lit, pat) {
  if (pat.startsWith(':')) return lit.length > 0;
  if (!lit.includes('${')) return lit === pat;
  const re = new RegExp('^' + lit.split(/\$\{[^}]*\}/).map(escapeRe).join('.*') + '$');
  return re.test(pat);
}

/**
 * Applies the first matching core rename to a path in today's form (relative to /api).
 * Prefix semantics per segment: `/panel/plugins` also renames `/panel/plugins/search`.
 * @param {string} p
 * @param {(lit: string, pat: string) => boolean} [match] segment test, default {@link segMatch}
 * @returns {{ path: string, renamed: boolean }}
 */
export function applyRenames(p, match = segMatch) {
  const segs = segments(p);
  for (const [from, to] of CORE_RENAMES) {
    const f = segments(from);
    if (segs.length < f.length) continue;
    const captured = {};
    let ok = true;
    for (let i = 0; i < f.length; i++) {
      if (f[i].startsWith(':')) captured[f[i]] = segs[i];
      else if (!match(segs[i], f[i])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const t = segments(to).map((s) => (s.startsWith(':') ? captured[s] ?? s : s));
    return { path: '/' + [...t, ...segs.slice(f.length)].join('/'), renamed: true };
  }
  return { path: p, renamed: false };
}
