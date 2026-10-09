package com.example.demo.routes

import com.example.demo.base.DemoApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType
import io.vertx.ext.web.validation.ValidationHandler
import com.panomc.platform.schema.dsl.Bodies.json
import com.panomc.platform.schema.dsl.Parameters.param
import com.panomc.platform.schema.dsl.ValidationHandlerBuilder

@Endpoint
class ValidatedAPI : DemoApi() {
    override val paths = listOf(Path("/validated", RouteType.POST))

    // "/api/demo/not-a-path" inside a string that is not a Path is left alone by step a
    val doc = "see /api/demo/validated"
}
