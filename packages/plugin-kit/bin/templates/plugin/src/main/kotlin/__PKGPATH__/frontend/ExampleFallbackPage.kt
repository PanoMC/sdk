package @@PACKAGE@@.frontend

// A fallback page is a plain page Pano serves at /_pano/<target> until a front-end (a theme, a custom app or an
// external site) takes the target over. Use one for a link your plugin sends out (a mail, a payment return) that
// must work on any front-end. Remove the // marks below to try it.
//
// 1. Declare the target in src/main/resources/frontend-targets.json (ids get your namespace in front,
//    so "order" below is "@@NS@@.order"):
//
//      { "order": { "path": "/order/{id}", "fallback": true } }
//
// 2. Add the page. `template` is a Handlebars file in src/main/resources, `model` is what it renders:
//
//      import com.panomc.platform.annotation.FallbackPageDefinition
//      import com.panomc.platform.frontend.FallbackPage
//      import io.vertx.ext.web.RoutingContext
//
//      @FallbackPageDefinition
//      class OrderFallbackPage : FallbackPage("order", "fallback/order.hbs") {
//          override suspend fun model(context: RoutingContext): Map<String, Any?> =
//              mapOf("id" to context.request().getParam("id"))
//      }
//
// 3. Build links with the URL map, never with a hard-coded path, so a renamed route keeps working:
//
//      frontendUrlMap.url("@@NS@@.order", mapOf("id" to orderId))
//
// A target with "fallback": true and no registered page fails the plugin load and names the target.
