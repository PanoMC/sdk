package com.panomc.plugins.license

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
import com.auth0.jwt.exceptions.TokenExpiredException
import com.panomc.platform.api.PanoPlugin
import com.panomc.platform.license.LicenseDeniedReason
import com.panomc.platform.license.LicenseRequiredException
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
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
 * The host is open source and not trusted here. The token is verified inside the plugin with the
 * plugin's own java-jwt (bundled into the plugin jar and relocated by build.gradle.kts, so no host
 * class can stand in for it), and every value that is checked (aud, sub, ver, hash, exp) is read from
 * that verified token, never from the claims the host parsed. The jar hash is computed here from the
 * plugin's own CodeSource, not asked from the host.
 *
 * For free plugins (PANO_PUBLIC_KEY_BASE64 is empty), [requireValidLicense] is a no-op so
 * a plugin can be migrated to/from premium without code changes — only by updating
 * build flags or `PANO_LICENSE_*` / `licenseServer` inputs for the Gradle build.
 */
class PluginLicenseClient(private val plugin: PanoPlugin) {
    /** Claims of the last successfully verified license. Cached so [assertStillLicensed] is cheap. */
    private val cachedClaims = AtomicReference<VerifiedClaims?>(null)

    private val embeddedPublicKey: RSAPublicKey? by lazy { decodePublicKey() }

    /**
     * True when this plugin is configured as premium (a public key was embedded at build time). A key that
     * cannot be parsed still counts as premium: [requireValidLicense] then fails with KEY_NOT_AVAILABLE.
     */
    val isPremium: Boolean
        get() = PluginBuildConstants.PANO_PUBLIC_KEY_BASE64.isNotBlank()

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

        // Re-verify with our OWN copy of the public key and our OWN java-jwt. This is the plugin's
        // actual security boundary: even if the host is patched/forked to inject a forged JWT or other
        // claims, an attacker can't sign one without panomc.com's private key.
        val claims = when (val result = verifyToken(license.rawJwt, pubKey, plugin.getLicenseJwtIssuer())) {
            is Verification.Valid -> result.claims
            Verification.Expired -> throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.EXPIRED,
                "license expired"
            )
            Verification.Invalid -> throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.SIGNATURE_INVALID,
                "license JWT signature is invalid (host may be tampered)"
            )
        }

        if (claims.audience.none { it.equals(plugin.pluginId, ignoreCase = true) }) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.AUDIENCE_MISMATCH,
                "expected ${plugin.pluginId}, got ${claims.audience.joinToString()}"
            )
        }
        if (claims.version != PluginBuildConstants.VERSION) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.VERSION_MISMATCH,
                "expected ${PluginBuildConstants.VERSION}, got ${claims.version}"
            )
        }

        val ownHash = ownJarSha256()
            ?: throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.JAR_HASH_MISMATCH,
                "the plugin is not running from its jar"
            )
        if (!claims.jarSha256.equals(ownHash, ignoreCase = true)) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.JAR_HASH_MISMATCH,
                "expected ${claims.jarSha256.take(12)}..., running ${ownHash.take(12)}..."
            )
        }
        if (claims.isExpired()) {
            throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.EXPIRED,
                "license expired (${claims.expiresAtMs})"
            )
        }

        cachedClaims.set(claims)
    }

    /**
     * Cheap runtime check intended to be sprinkled across critical call sites (route
     * handlers, scheduled jobs, etc.). Throws if the cache went away (token expired and
     * could not be refreshed). Exists so a cracker cannot get away with patching out the
     * single `requireValidLicense()` call in `onStart`.
     */
    suspend fun assertStillLicensed() {
        if (!isPremium) return
        val cached = cachedClaims.get()
        if (cached == null || cached.isExpired()) {
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

    /** The claims this plugin checks, read from a token whose signature it verified itself. */
    class VerifiedClaims(
        val subject: String,
        val audience: List<String>,
        val version: String,
        val jarSha256: String,
        val expiresAtMs: Long,
    ) {
        fun isExpired(nowMs: Long = System.currentTimeMillis()): Boolean = nowMs >= expiresAtMs
    }

    sealed class Verification {
        class Valid(val claims: VerifiedClaims) : Verification()
        object Expired : Verification()
        object Invalid : Verification()
    }

    companion object {
        /**
         * Verifies an RS256 JWT with [publicKey] and [expectedIssuer] and returns its claims. [Verification.Invalid]
         * when the token is malformed, wrongly signed, from another issuer, or misses sub, aud, ver, hash or exp.
         */
        fun verifyToken(rawJwt: String, publicKey: RSAPublicKey, expectedIssuer: String): Verification {
            val decoded = try {
                JWT.require(Algorithm.RSA256(publicKey, null))
                    .withIssuer(expectedIssuer)
                    .build()
                    .verify(rawJwt)
            } catch (_: TokenExpiredException) {
                return Verification.Expired
            } catch (_: JWTVerificationException) {
                return Verification.Invalid
            } catch (_: Exception) {
                return Verification.Invalid
            }

            val subject = decoded.subject?.takeIf { it.isNotBlank() }
            val audience = decoded.audience.orEmpty().filter { it.isNotBlank() }
            val version = decoded.getClaim("ver").asString()
            val hash = decoded.getClaim("hash").asString()?.takeIf { it.isNotBlank() }
            val expiresAt = decoded.expiresAt
            if (subject == null || audience.isEmpty() || version == null || hash == null || expiresAt == null) {
                return Verification.Invalid
            }

            return Verification.Valid(VerifiedClaims(subject, audience, version, hash, expiresAt.time))
        }

        /** SHA-256 (hex) of the jar this class was loaded from, or null when it is not loaded from a jar file. */
        fun ownJarSha256(): String? = try {
            val location = PluginLicenseClient::class.java.protectionDomain?.codeSource?.location
            val file = location?.toURI()?.let(::File)
            if (file == null || !file.isFile) null else {
                val digest = MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        digest.update(buffer, 0, read)
                    }
                }
                digest.digest().joinToString("") { "%02x".format(it) }
            }
        } catch (_: Exception) {
            null
        }
    }
}
