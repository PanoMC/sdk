/** Matches Kotlin `VersionUtil.isSemVer` (optional leading v tag). */
function isSemVer(version) {
  return /^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(version);
}

/** Kotlin `parseVersion(removePrefix(version, "v"))` with hyphen split limited to core + prerelease remainder. */
function parseVersion(version) {
  const cleanVersion = version.replace(/^v/, '');
  const hyphen = cleanVersion.indexOf('-');
  const corePart = hyphen === -1 ? cleanVersion : cleanVersion.slice(0, hyphen);
  const preRaw = hyphen === -1 ? '' : cleanVersion.slice(hyphen + 1);
  const coreParts = corePart.split('.').map((p) => Number(p));
  const preParts = preRaw
    ? preRaw.split('.').map((part) => {
        const parsed = /^-?\d+$/.test(part) ? Number(part) : NaN;
        return Number.isNaN(parsed) ? part : parsed;
      })
    : [];
  return { coreParts, preParts };
}

/** Kotlin `compareVersions`; does not coerce non-tags (opaque tags compare only via `===`). */
export function compareVersions(a, b) {
  const isASemVer = isSemVer(a);
  const isBSemVer = isSemVer(b);

  if (!isASemVer && !isBSemVer) return 0;
  if (!isASemVer) return -1;
  if (!isBSemVer) return 1;

  const va = parseVersion(a);
  const vb = parseVersion(b);

  const len = Math.max(va.coreParts.length, vb.coreParts.length);
  for (let i = 0; i < len; i++) {
    const ai = va.coreParts[i] || 0;
    const bi = vb.coreParts[i] || 0;
    if (ai !== bi) return ai - bi;
  }

  const prePriority = ['alpha', 'beta'];

  const isAPre = va.preParts.length > 0;
  const isBPre = vb.preParts.length > 0;

  if (!isAPre && isBPre) return 1;
  if (isAPre && !isBPre) return -1;

  for (let i = 0; i < Math.max(va.preParts.length, vb.preParts.length); i++) {
    const ap = va.preParts[i];
    const bp = vb.preParts[i];
    if (ap === bp) continue;

    if (typeof ap === 'string' && typeof bp === 'string') {
      const ai = prePriority.indexOf(ap);
      const bi = prePriority.indexOf(bp);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    }
    if (typeof ap === 'number' && typeof bp === 'number') return ap - bp;
    return typeof ap === 'string' ? -1 : 1;
  }

  return 0;
}

/** Kotlin `isVersionHigher` — installed `local-build` is treated below any normal semver release. */
export function isStoreVersionHigher(latestPublishedTag, installedTag) {
  const normalizedInstalled =
    installedTag === 'local-build' ? 'v1.0.0-alpha.0' : installedTag;
  return compareVersions(latestPublishedTag, normalizedInstalled) > 0;
}

/**
 * Same release according to Kotlin store rules (exact tag strings or semver-equal, including optional `v`).
 */
export function areStoreVersionTagsEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (!isSemVer(a) || !isSemVer(b)) return false;
  return compareVersions(a, b) === 0;
}

export function isPanoVersionCompatible(current, required) {
  if (current === 'local-build') return true;
  if (!isSemVer(current) || !isSemVer(required)) return false;

  const currentParsed = parseVersion(current);
  const requiredParsed = parseVersion(required);

  const coreEqual =
    JSON.stringify(currentParsed.coreParts) === JSON.stringify(requiredParsed.coreParts);

  const requiredIsPre = requiredParsed.preParts.length > 0;

  if (coreEqual && !requiredIsPre) {
    return true;
  }

  return compareVersions(current, required) >= 0;
}
