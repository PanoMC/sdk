package com.example.demo.routes

import com.example.demo.base.DemoPanelApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType

@Endpoint
class PanelSaveThingAPI : DemoPanelApi() {
    override val paths = listOf(Path("/api/panel/demo/things/:id", RouteType.PUT))
}
