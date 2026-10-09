package com.example.demo.routes

import com.example.demo.base.DemoApi
import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.Path
import com.panomc.platform.model.RouteType

@Endpoint
class WebhookAPI : DemoApi() {
    override val paths = listOf(
        Path(WEBHOOK_PATH, RouteType.ROUTE),
        Path("$WEBHOOK_PATH/:channel", RouteType.ROUTE),
        Path(Inbound.RETURN_PATH + "/:name", RouteType.GET)
    )

    companion object {
        const val WEBHOOK_PATH = "/webhook/:id"
    }
}

object Inbound {
    const val RETURN_PATH = "/payments/:providerId/return"
}
