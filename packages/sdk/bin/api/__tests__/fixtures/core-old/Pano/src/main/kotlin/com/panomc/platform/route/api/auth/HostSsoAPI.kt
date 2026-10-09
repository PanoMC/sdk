package com.panomc.platform.route.api.auth

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class HostSsoAPI : Api() {
    override val mount = Mount.ROOT
    override val paths = listOf(Path("/panel/host-sso", RouteType.GET))
}
