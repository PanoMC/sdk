package com.example.demo.routes

import com.example.demo.base.DemoMiddleApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType

// The base class is found through two supertypes: DemoMiddleApi -> DemoApi -> Api.
@Endpoint
class GetThingsAPI(private val plugin: DemoPlugin) : DemoMiddleApi() {
    override val paths = listOf(
        Path("/api/demo/things", RouteType.GET),
        Path("/api/demo/things/:id", RouteType.GET),
        Path("/api/other/list", RouteType.GET)
    )
}
