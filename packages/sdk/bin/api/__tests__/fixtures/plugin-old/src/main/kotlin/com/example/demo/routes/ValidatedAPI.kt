package com.example.demo.routes

import com.example.demo.base.DemoApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType
import io.vertx.ext.web.validation.ValidationHandler
import io.vertx.ext.web.validation.builder.Bodies.json
import io.vertx.ext.web.validation.builder.Parameters.param
import io.vertx.ext.web.validation.builder.ValidationHandlerBuilder

@Endpoint
class ValidatedAPI : DemoApi() {
    override val paths = listOf(Path("/api/demo/validated", RouteType.POST))

    // "/api/demo/not-a-path" inside a string that is not a Path is left alone by step a
    val doc = "see /api/demo/validated"
}
