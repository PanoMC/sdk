package com.panomc.plugins.license

import com.panomc.platform.api.PanoPlugin
import com.panomc.platform.license.LicenseDeniedReason
import com.panomc.platform.license.LicenseRequiredException
import com.panomc.platform.license.SignedLicense
import java.security.KeyFactory
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference

/**
 * Helper a premium Pano plugin uses to ask the host for a license token AND independently
 * verify the result against its own embedded panomc.com public key.
 *
 * Usage:
 * ```
 * class MyPremiumPlugin : PanoPlugin() {
 *     private val licenseClient by lazy { PluginLicenseClient(this) }
 *     override suspend fun onStart() {
 *         licenseClient.requireValidLicense()
 *         // ... rest of startup
 *     }
 * }
 * ```
 *
 * This class is intentionally short and self-contained so plugin authors can copy it into
 * their own plugin if they want to customise behaviour (e.g. additional anti-tamper
 * measures). The boilerplate ships it as the canonical implementation.
 *
 * For free plugins (PANO_PUBLIC_KEY_BASE64 is empty), [requireValidLicense] is a no-op so
 * a plugin can be migrated to/from premium without code changes — only by updating
 * build flags or `PANO_LICENSE_*` / `licenseServer` inputs for the Gradle build.
 */
class PluginLicenseClient(private val plugin: PanoPlugin) {
    /** Last successfully verified license. Cached so [assertStillLicensed] is cheap. */
    private val cachedLicense = AtomicReference<SignedLicense?>(null)

    private val embeddedPublicKey: RSAPublicKey? by lazy { decodePublicKey() }

    /** True when this plugin is configured as premium (i.e. embedded a public key). */
    val isPremium: Boolean
        get() = embeddedPublicKey != null

    /**
     * Fetches a fresh license from panomc.com via the host, verifies it locally with the
     * embedded public key, and asserts the JWT claims match this plugin's compile-time
     * identity (resourceId, version, JAR sha256). Uses [PanoPlugin.getLicenseJwtIssuer] for the
     * JWT `iss` check (from `pano-website-url` / `pano-api-url`; see [PanoPlugin.getLicenseJwtIssuer]).
     * Throws [LicenseRequiredException] if anything is off.
     */
    suspend fun requireValidLicense() {
        if (!isPremium) return

        val pubKey = embeddedPublicKey
            ?: throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.KEY_NOT_AVAILABLE,
                "embedded panomc.com public key is malformed"
            )

        val license = plugin.getLicenseManager().requireLicense(
            plugin = plugin,
            resourceId = plugin.pluginId,
            version = PluginBuildConstants.VERSION
        )

        // Re-verify with our OWN copy of the public key. This is the plugin's actual
        // security boundary: even if the host is patched/forked to inject a forged JWT,
        // an attacker can't sign one without panomc.com's private key.
        if (!license.verifySignature(pubKey, plugin.getLicenseJwtIssuer())) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.SIGNATURE_INVALID,
                "license JWT signature is invalid (host may be tampered)"
            )
        }

        if (!license.claims.resourceId.equals(plugin.pluginId, ignoreCase = true)) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.AUDIENCE_MISMATCH,
                "expected ${plugin.pluginId}, got ${license.claims.resourceId}"
            )
        }
        if (license.claims.version != PluginBuildConstants.VERSION) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.VERSION_MISMATCH,
                "expected ${PluginBuildConstants.VERSION}, got ${license.claims.version}"
            )
        }

        val ownHash = plugin.getOwnJarSha256()
        if (ownHash != null && !license.claims.jarSha256.equals(ownHash, ignoreCase = true)) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.JAR_HASH_MISMATCH,
                "expected ${license.claims.jarSha256.take(12)}..., running ${ownHash.take(12)}..."
            )
        }
        if (license.claims.isExpired()) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.EXPIRED,
                "license expired (${license.claims.expiresAtMs})"
            )
        }

        cachedLicense.set(license)
    }

    /**
     * Cheap runtime check intended to be sprinkled across critical call sites (route
     * handlers, scheduled jobs, etc.). Throws if the cache went away (token expired and
     * could not be refreshed). Exists so a cracker cannot get away with patching out the
     * single `requireValidLicense()` call in `onStart`.
     */
    suspend fun assertStillLicensed() {
        if (!isPremium) return
        val cached = cachedLicense.get()
        if (cached == null || cached.claims.isExpired()) {
            requireValidLicense()
        }
    }

    private fun decodePublicKey(): RSAPublicKey? {
        val raw = PluginBuildConstants.PANO_PUBLIC_KEY_BASE64
        if (raw.isBlank()) return null
        return try {
            // Accept either pure Base64 or PEM-encoded ("-----BEGIN PUBLIC KEY-----...").
            val body = raw
                .replace(Regex("-----BEGIN [^-]+-----"), "")
                .replace(Regex("-----END [^-]+-----"), "")
                .replace(Regex("\\s+"), "")
            val der = Base64.getDecoder().decode(body)
            val spec = X509EncodedKeySpec(der)
            KeyFactory.getInstance("RSA").generatePublic(spec) as RSAPublicKey
        } catch (_: Exception) {
            null
        }
    }
}
