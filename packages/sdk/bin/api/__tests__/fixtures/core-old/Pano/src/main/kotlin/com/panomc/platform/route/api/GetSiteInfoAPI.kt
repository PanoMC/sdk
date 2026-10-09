package com.panomc.platform.route.api

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class GetSiteInfoAPI : Api() {
    override val paths = listOf(Path("/api/siteInfo", RouteType.GET))
}

@Endpoint
class GetThumbnailAPI : Api() {
    override val paths = listOf(Path("/api/post/thumbnail/:filename", RouteType.GET))
}

@Endpoint
class GetPostsAPI : Api() {
    override val paths = listOf(Path("/api/posts", RouteType.GET), Path("/api/posts/:url", RouteType.GET))
}
