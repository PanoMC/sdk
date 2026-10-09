package com.panomc.platform.route.api.panel

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class PanelGetAddonsAPI : PanelApi() {
    override val paths = listOf(Path("/api/panel/plugins", RouteType.GET), Path("/api/panel/plugins/search", RouteType.GET))
}

@Endpoint
class PanelGetPostsAPI : PanelApi() {
    override val paths = listOf(Path("/api/panel/posts", RouteType.GET))
}

// A PanelApi that is a site path: the class overrides the namespace, so /panel is not touched.
@Endpoint
class PanelGetDefaultServerIconAPI : PanelApi() {
    override val namespace = Namespace.SITE
    override val paths = listOf(Path("/api/server/icon/default", RouteType.GET))
}

// Not a PanelApi but served under /panel: the class overrides the namespace.
@Endpoint
class PanelIsUserExistsAPI : Api() {
    override val namespace = Namespace.PANEL
    override val paths = listOf(Path("/api/panel/players/:username/exists", RouteType.GET))
}
