package com.example.demo.routes

import com.example.demo.base.DemoMiddleApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType

// The base class is found through two supertypes: DemoMiddleApi -> DemoApi -> Api.
@Endpoint
class GetThingsAPI(private val plugin: DemoPlugin) : DemoMiddleApi() {
    override val paths = listOf(
        Path("/things", RouteType.GET),
        Path("/things/:id", RouteType.GET),
        Path("/other/list", RouteType.GET)
    )
}
