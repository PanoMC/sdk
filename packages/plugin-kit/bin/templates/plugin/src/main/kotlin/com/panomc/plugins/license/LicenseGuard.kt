package com.panomc.plugins.license

import com.panomc.platform.api.PanoPlugin

/**
 * Convenience entry point for distributing license checks across a plugin's
 * critical call sites. Sprinkle these calls inside route handlers, scheduled
 * jobs, websocket handlers, etc. so removing any single check is not enough
 * to bypass the DRM. The actual logic lives in [PluginLicenseClient].
 *
 * Example:
 * ```
 * override suspend fun handle(context: RoutingContext): Result {
 *     LicenseGuard.assert(plugin)
 *     // ... business logic
 * }
 * ```
 */
object LicenseGuard {
    private val clients = java.util.concurrent.ConcurrentHashMap<String, PluginLicenseClient>()

    /**
     * Cheap (mostly cached) license re-check. Throws [com.panomc.platform.license.LicenseRequiredException]
     * if the plugin has lost its license at runtime.
     */
    suspend fun assert(plugin: PanoPlugin) {
        val client = clients.computeIfAbsent(plugin.pluginId) { PluginLicenseClient(plugin) }
        client.assertStillLicensed()
    }
}
