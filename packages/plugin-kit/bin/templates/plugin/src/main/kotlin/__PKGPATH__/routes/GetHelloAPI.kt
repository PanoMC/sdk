package @@PACKAGE@@.routes

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.model.*
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.validation.ValidationHandler
import io.vertx.json.schema.SchemaRepository

// Declare the path without a prefix: Pano mounts this at GET /api/plugins/@@ID@@/hello.
// The page src/theme/views/HelloPage.svelte reads it with api.get({ path: '/hello' }).
@Endpoint
class GetHelloAPI : Api() {
    override val paths = listOf(Path("/hello", RouteType.GET))

    // No request validation for this endpoint; declared so the class compiles against every Pano version.
    override fun getValidationHandler(schemaRepository: SchemaRepository): ValidationHandler? = null

    override suspend fun handle(context: RoutingContext): Result = Successful(mapOf("message" to "hi"))
}
