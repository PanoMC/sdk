package x

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class LegacyAPI : Api() {
    override val paths = listOf(Path("/api/posts", RouteType.GET))
}

@Endpoint
class NoSlashAPI : Api() {
    override val paths = listOf(Path("hello", RouteType.GET))
}

@Endpoint
class PanelPrefixAPI : Api() {
    override val paths = listOf(Path("/panel/settings", RouteType.GET))
}

@Endpoint
class ParamFirstAPI : Api() {
    override val paths = listOf(Path("/:id", RouteType.GET))
}

@Endpoint
class ReservedAPI : Api() {
    override val paths = listOf(Path("/_/x", RouteType.GET))
}

@Endpoint
class DupOneAPI : Api() {
    override val paths = listOf(Path("/items/:id", RouteType.GET))
}

@Endpoint
class DupTwoAPI : Api() {
    override val paths = listOf(Path("/items/:other", RouteType.GET))
}
