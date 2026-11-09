package com.panomc.plugins.license

import com.panomc.platform.api.PanoPlugin
import com.panomc.platform.license.LicenseDeniedReason
import com.panomc.platform.license.LicenseRequiredException
import java.security.KeyFactory
import java.security.Signature
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
 * The token is verified here with the JDK only (java.security), and every claim that is checked is read
 * from that verified token, never from the claims the host parsed: a patched host cannot pair a real
 * token with other claims.
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

        // Re-verify with our OWN copy of the public key. This is the plugin's actual
        // security boundary: even if the host is patched/forked to inject a forged JWT,
        // an attacker can't sign one without panomc.com's private key.
        val claims = verifyToken(license.rawJwt, pubKey, plugin.getLicenseJwtIssuer())
            ?: throw LicenseRequiredException(
                plugin.pluginId,
                LicenseDeniedReason.SIGNATURE_INVALID,
                "license JWT signature is invalid (host may be tampered)"
            )

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

        val ownHash = plugin.getOwnJarSha256()
        if (ownHash != null && !claims.jarSha256.equals(ownHash, ignoreCase = true)) {
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
        val audience: List<String>,
        val version: String,
        val jarSha256: String,
        val expiresAtMs: Long,
    ) {
        fun isExpired(nowMs: Long = System.currentTimeMillis()): Boolean = nowMs >= expiresAtMs
    }

    companion object {
        /**
         * Verifies an RS256 JWT with [publicKey] and [expectedIssuer] and returns its claims, or null when the
         * token is malformed, not RS256, wrongly signed, from another issuer, or misses a claim.
         */
        fun verifyToken(rawJwt: String, publicKey: RSAPublicKey, expectedIssuer: String): VerifiedClaims? = try {
            val parts = rawJwt.split('.')
            require(parts.size == 3)
            val decoder = Base64.getUrlDecoder()
            val header = MiniJson.parseObject(String(decoder.decode(parts[0]), Charsets.UTF_8))
            require(header["alg"] == "RS256")

            val verifier = Signature.getInstance("SHA256withRSA")
            verifier.initVerify(publicKey)
            verifier.update("${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII))
            require(verifier.verify(decoder.decode(parts[2])))

            val payload = MiniJson.parseObject(String(decoder.decode(parts[1]), Charsets.UTF_8))
            val audience = when (val aud = payload["aud"]) {
                is String -> listOf(aud)
                is List<*> -> aud.filterIsInstance<String>()
                else -> emptyList()
            }
            val version = payload["ver"] as? String
            val hash = payload["hash"] as? String
            val exp = (payload["exp"] as? Number)?.toLong()
            require(payload["iss"] == expectedIssuer && audience.isNotEmpty())
            require(version != null && hash != null && exp != null)

            VerifiedClaims(audience, version, hash, exp * 1000)
        } catch (_: Exception) {
            null
        }
    }

    /** Just enough JSON for a JWT header and payload, so the check needs nothing the host loads. */
    private class MiniJson private constructor(private val text: String) {
        private var at = 0

        companion object {
            fun parseObject(text: String): Map<String, Any?> {
                val parser = MiniJson(text)
                val value = parser.value()
                parser.space()
                require(parser.at == text.length && value is Map<*, *>) { "not a JSON object" }
                @Suppress("UNCHECKED_CAST")
                return value as Map<String, Any?>
            }
        }

        private fun space() {
            while (at < text.length && text[at].isWhitespace()) at++
        }

        private fun value(): Any? {
            space()
            require(at < text.length) { "unexpected end" }
            val c = text[at]
            return when {
                c == '{' -> obj()
                c == '[' -> array()
                c == '"' -> string()
                c == 't' -> literal("true", true)
                c == 'f' -> literal("false", false)
                c == 'n' -> literal("null", null)
                c == '-' || c.isDigit() -> number()
                else -> throw IllegalArgumentException("unexpected character")
            }
        }

        private fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            at++
            space()
            if (text.getOrNull(at) == '}') {
                at++
                return out
            }
            while (true) {
                space()
                val key = string()
                space()
                require(text.getOrNull(at) == ':') { "expected a colon" }
                at++
                out[key] = value()
                space()
                when (text.getOrNull(at)) {
                    ',' -> at++
                    '}' -> {
                        at++
                        return out
                    }
                    else -> throw IllegalArgumentException("expected a comma or the end of the object")
                }
            }
        }

        private fun array(): List<Any?> {
            val out = ArrayList<Any?>()
            at++
            space()
            if (text.getOrNull(at) == ']') {
                at++
                return out
            }
            while (true) {
                out.add(value())
                space()
                when (text.getOrNull(at)) {
                    ',' -> at++
                    ']' -> {
                        at++
                        return out
                    }
                    else -> throw IllegalArgumentException("expected a comma or the end of the array")
                }
            }
        }

        private fun string(): String {
            require(text.getOrNull(at) == '"') { "expected a string" }
            at++
            val out = StringBuilder()
            while (true) {
                require(at < text.length) { "unterminated string" }
                val c = text[at++]
                if (c == '"') return out.toString()
                if (c != '\\') {
                    out.append(c)
                    continue
                }
                require(at < text.length) { "bad escape" }
                when (val e = text[at++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        require(at + 4 <= text.length) { "bad escape" }
                        out.append(text.substring(at, at + 4).toInt(16).toChar())
                        at += 4
                    }
                    else -> throw IllegalArgumentException("bad escape")
                }
            }
        }

        private fun number(): Number {
            val start = at
            while (at < text.length && (text[at].isDigit() || text[at] in "+-.eE")) at++
            val raw = text.substring(start, at)
            return raw.toLongOrNull() ?: raw.toDouble()
        }

        private fun literal(word: String, result: Any?): Any? {
            require(text.startsWith(word, at)) { "unexpected literal" }
            at += word.length
            return result
        }
    }
}
