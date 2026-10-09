package com.example.demo.base

import com.panomc.platform.model.Api
import com.panomc.platform.model.PanelApi

/** Base of the site endpoints. KDoc nests: /* inner */ still a comment. */
abstract class DemoApi : Api() {
    open val needsLogin = false
}

abstract class DemoPanelApi : PanelApi()

abstract class DemoMiddleApi : DemoApi()
