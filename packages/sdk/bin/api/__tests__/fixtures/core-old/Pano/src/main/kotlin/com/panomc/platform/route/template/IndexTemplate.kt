package com.panomc.platform.route.template

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class IndexTemplate : Template() {
    override val paths = listOf(Path("/*", RouteType.ROUTE))
}
