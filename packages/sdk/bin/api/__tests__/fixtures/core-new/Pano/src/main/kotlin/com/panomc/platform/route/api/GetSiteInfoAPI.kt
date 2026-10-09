package com.panomc.platform.route.api

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class GetSiteInfoAPI : Api() {
    override val paths = listOf(Path("/site-info", RouteType.GET))
}

@Endpoint
class GetThumbnailAPI : Api() {
    override val paths = listOf(Path("/posts/thumbnails/:filename", RouteType.GET))
}

@Endpoint
class GetPostsAPI : Api() {
    override val paths = listOf(Path("/posts", RouteType.GET), Path("/posts/:url", RouteType.GET))
}
