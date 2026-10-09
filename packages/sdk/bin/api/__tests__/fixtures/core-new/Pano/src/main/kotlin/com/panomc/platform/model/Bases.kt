package com.panomc.platform.model

abstract class Route {
    abstract val paths: List<Path>
}

enum class Mount { API, ROOT }

enum class Namespace { SITE, PANEL }

abstract class Api : Route() {
    override val mount = Mount.API
}

abstract class LoggedInApi : Api()

abstract class PanelApi : LoggedInApi() {
    override val namespace = Namespace.PANEL
}

abstract class Template : Route()
