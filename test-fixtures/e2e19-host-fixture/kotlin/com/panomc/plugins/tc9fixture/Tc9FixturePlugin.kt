package com.panomc.plugins.tc9fixture

import com.panomc.platform.annotation.Endpoint
import com.panomc.platform.annotation.NotificationDefinition
import com.panomc.platform.annotation.PermissionDefinition
import com.panomc.platform.api.PanoPlugin
import com.panomc.platform.auth.PanelPermission
import com.panomc.platform.db.DatabaseManager
import com.panomc.platform.auth.AuthProvider
import com.panomc.platform.i18n.I18nManager
import com.panomc.platform.mail.Mail
import com.panomc.platform.mail.MailFile
import com.panomc.platform.mail.MailManager
import com.panomc.platform.mail.MailOptions
import com.panomc.platform.mail.MailParameters
import com.panomc.platform.model.PanelApi
import com.panomc.platform.model.Path
import com.panomc.platform.model.Result
import com.panomc.platform.model.RouteType
import com.panomc.platform.model.Successful
import com.panomc.platform.notification.NotificationManager
import com.panomc.platform.notification.PanelUserNotificationType
import com.panomc.platform.notification.type.panel.PanoUpdateFoundNotification
import io.vertx.ext.web.RoutingContext
import io.vertx.ext.web.validation.ValidationHandler
import io.vertx.json.schema.SchemaRepository

/**
 * E2E-19 host fixture plugin (test only, never shipped, id `tc9-fixture`). One jar for the three host checks that need a real plugin:
 * TC-9 / PUI-2 (the UI bundle under `plugin-ui.zip`), P-5.3 (a plugin notification type, a core row, the permission node) and P-4.3
 * (a mail with locale, text, Reply-To and a PDF attachment). It has no license check and touches no table.
 */
class Tc9FixturePlugin : PanoPlugin() {
    override suspend fun onStart() {
        logger.info("[Tc9Fixture] - Started!")
    }
}

/** A panel notification type owned by this plugin: text key `notifications.FIXTURE`, optional clickable `href`. */
@NotificationDefinition
data class FixtureNotification(
    val href: String? = null,
    val faIcon: String? = "fa-flask"
) : PanelUserNotificationType()

/** Node `pano.plugin.tc9-fixture.view.fixture`: gates the fixture's player tab (PUI-2 item 2). */
@PermissionDefinition
class ViewFixturePermission : PanelPermission("fa-flask")

/** `POST /api/panel/tc9-fixture/notify?href=/fixture`: one FIXTURE row (plugin type) and one PANO_UPDATE_FOUND row (core type) for the caller. */
@Endpoint
class FixtureNotifyAPI(private val plugin: Tc9FixturePlugin) : PanelApi() {
    override val paths = listOf(Path("/api/panel/tc9-fixture/notify", RouteType.POST))

    override fun getValidationHandler(schemaRepository: SchemaRepository): ValidationHandler? = null

    override suspend fun handle(context: RoutingContext): Result {
        val ctx = plugin.applicationContext
        val userId = ctx.getBean(AuthProvider::class.java).getUserIdFromRoutingContext(context)
        val notifications = ctx.getBean(NotificationManager::class.java)
        val sqlClient = getSqlClient()
        val href = context.request().getParam("href")?.takeIf { it.isNotBlank() }

        notifications.sendPanelNotification(userId, FixtureNotification(href = href), sqlClient)
        notifications.sendPanelNotification(userId, PanoUpdateFoundNotification(version = "9.9.9-fixture"), sqlClient)

        return Successful()
    }
}

class FixtureMailParameters(val text: String) : MailParameters

/** `subject` is a platform translation key (used only when `MailOptions.subject` is absent: proves `MailOptions.locale`). */
class FixtureMail(private val bodyText: String) : Mail {
    override val templatePath = "mail/fixture-mail.hbs"
    override val subject = "mail.password-updated.subject"

    override suspend fun generateParameters(
        systemParameters: MailManager.Companion.SystemParameters,
        i18nManager: I18nManager,
        locale: String
    ): MailParameters = FixtureMailParameters(bodyText)
}

/**
 * `POST /api/panel/tc9-fixture/mail?to=guest@example.com&locale=tr&replyTo=a@b.co&subject=...&text=...`: sends through the real `MailManager`
 * with `MailOptions(email, locale, subject, text, replyTo, attachments = [a PDF])`; the answer carries the `MailResult` name.
 */
@Endpoint
class FixtureMailAPI(private val plugin: Tc9FixturePlugin) : PanelApi() {
    override val paths = listOf(Path("/api/panel/tc9-fixture/mail", RouteType.POST))

    override fun getValidationHandler(schemaRepository: SchemaRepository): ValidationHandler? = null

    override suspend fun handle(context: RoutingContext): Result {
        val ctx = plugin.applicationContext
        val request = context.request()
        val subject = request.getParam("subject")
        val text = request.getParam("text") ?: "plain text part"
        val options = MailOptions(
            email = request.getParam("to"),
            locale = request.getParam("locale"),
            subject = subject,
            text = text,
            replyTo = request.getParam("replyTo"),
            attachments = listOf(MailFile("invoice.pdf", "application/pdf", PDF_BYTES))
        )
        val result = ctx.getBean(MailManager::class.java)
            .sendMail(getSqlClient(), null, FixtureMail(text), options)

        return Successful(
            mapOf(
                "result" to result.name,
                "attachmentBytes" to PDF_BYTES.size,
                "attachmentSha256" to java.security.MessageDigest.getInstance("SHA-256").digest(PDF_BYTES)
                    .joinToString("") { "%02x".format(it) }
            )
        )
    }

    companion object {
        /** A tiny but structurally real PDF with a few non-ASCII-safe bytes (binary marker line), so a corrupted transfer shows. */
        val PDF_BYTES: ByteArray = (
            "%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
                "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
                "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
                "trailer<</Root 1 0 R>>\n%%EOF\n"
            ).toByteArray(Charsets.ISO_8859_1)
    }
}
