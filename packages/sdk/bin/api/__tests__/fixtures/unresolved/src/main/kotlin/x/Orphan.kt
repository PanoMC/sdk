package x

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*

@Endpoint
class OrphanAPI : Unknown() {
    override val paths = listOf(Path("/orphan", RouteType.GET))
}

@Endpoint
class NoPathAPI : Api() {
    override val paths = emptyList<Path>()
}

@Endpoint
class BadConstAPI : Api() {
    override val paths = listOf(Path(MISSING_CONST, RouteType.GET))
}
