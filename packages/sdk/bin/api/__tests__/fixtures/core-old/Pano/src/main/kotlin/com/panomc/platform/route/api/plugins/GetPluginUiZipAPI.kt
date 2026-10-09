package com.panomc.platform.route.api.plugins

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class GetPluginUiZipAPI : Api() {
    override val paths = listOf(Path("/api/plugins/:pluginId/resources/plugin-ui.zip", RouteType.GET))
}
