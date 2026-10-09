import java.net.URL
import java.util.Properties
import java.util.zip.ZipFile

plugins {
    kotlin("jvm") version "2.2.21"
    kotlin("kapt") version "2.2.21"
    id("com.gradleup.shadow") version "8.3.8"
    `maven-publish`
}

group = "@@PACKAGE@@"
version =
    (if (project.hasProperty("version") && project.findProperty("version") != "unspecified") project.findProperty("version") else "local-build")!!

val pf4jVersion: String by project
val vertxVersion: String by project
val gsonVersion: String by project
val handlebarsVersion: String by project
val springContextVersion: String by project
val bootstrap = (project.findProperty("bootstrap") as String?)?.toBoolean() ?: false
val noui = project.hasProperty("noui")
// Where copyJar puts the jar: the pluginsDir of the pano-web-platform tree when this plugin is built inside
// it, else panoPluginsDir of gradle.properties (".." = the plugins folder this plugin lives in).
val pluginsDir: File? =
    (if (rootProject.extra.has("pluginsDir")) rootProject.extra["pluginsDir"] as File? else null)
        ?: (findProperty("panoPluginsDir") as String?)?.takeIf { it.isNotBlank() }?.let { projectDir.resolve(it) }

val os = System.getProperty("os.name").lowercase()
val arch = System.getProperty("os.arch").lowercase()

val isWindows = os.contains("win")
val isMac = os.contains("mac")
val isLinux = os.contains("nix") || os.contains("nux") || os.contains("linux")

val isAarch64 = arch.contains("aarch64") || arch.contains("arm64")
val isX64 = arch.contains("x86_64") || arch.contains("amd64")

val bunVersion = "1.2.0"
val bunPlatform = when {
    isWindows && isX64 -> "bun-windows-x64"
//    isWindows && isAarch64 -> "bun-windows-aarch64"
    isMac && isX64 -> "bun-darwin-x64"
    isMac && isAarch64 -> "bun-darwin-aarch64"
    isLinux && isX64 -> "bun-linux-x64"
    isLinux && isAarch64 -> "bun-linux-aarch64"
    else -> throw RuntimeException("Unsupported OS or Architecture")
}
val bunUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$bunVersion/$bunPlatform.zip"

val bunDir = File(layout.buildDirectory.asFile.get().absolutePath, "bun")
val bunBinDir = File(bunDir, bunPlatform)
var bunBin = if (isWindows) File(bunBinDir, "bun.exe") else File(bunBinDir, "bun")

val pluginId: String by project

// api-level: "panoApiLevel" of the pano-web-platform tree this plugin is built in, else "current" from
// the pano-api-level.properties inside the Pano jar on compileClasspath. `apiLevel=` in gradle.properties lowers it.
val panoApiLevel: String? by lazy {
    (findProperty("apiLevel") as String?)
        ?: (rootProject.findProperty("panoApiLevel") as String?)
        ?: configurations.findByName("compileClasspath")?.files?.firstNotNullOfOrNull { jar ->
            if (!jar.isFile || !jar.name.endsWith(".jar")) null
            else ZipFile(jar).use { zip ->
                zip.getEntry("pano-api-level.properties")?.let { entry ->
                    Properties().apply { load(zip.getInputStream(entry)) }.getProperty("current")
                }
            }
        }
}
val pluginName: String by project
val pluginDescription: String? by project
val pluginPanoVersion: String by project
val pluginClass: String by project
val pluginDeveloper: String by project
val pluginLicense: String? by project
val pluginSourceUrl: String? by project
val pluginDependencies: String? by project
val pluginRequires: String? by project
val pluginFreemium: String? by project

val organization: String? by project

repositories {
    mavenCentral()
    maven("https://jitpack.io")
}

dependencies {
    if (bootstrap) {
        compileOnly(project(mapOf("path" to ":Pano")))
    } else {
        compileOnly("com.github.panomc:pano:v1.0.0-alpha.463")
    }

    compileOnly(kotlin("stdlib-jdk8"))
    compileOnly(kotlin("reflect"))

    compileOnly("org.pf4j:pf4j:${pf4jVersion}")
    kapt("org.pf4j:pf4j:${pf4jVersion}")
    compileOnly("io.vertx:vertx-web:${vertxVersion}")
    compileOnly("io.vertx:vertx-lang-kotlin:${vertxVersion}")
    compileOnly("io.vertx:vertx-lang-kotlin-coroutines:${vertxVersion}")
    compileOnly("io.vertx:vertx-jdbc-client:${vertxVersion}")
    compileOnly("io.vertx:vertx-json-schema:${vertxVersion}")
    compileOnly("io.vertx:vertx-web-validation:${vertxVersion}")
    compileOnly("io.vertx:vertx-mysql-client:${vertxVersion}")

    // https://mvnrepository.com/artifact/org.springframework/spring-context
    compileOnly("org.springframework:spring-context:${springContextVersion}")
}

val panoLicensePublicKey: String? by project
val premiumLicenseSrcDir = layout.buildDirectory.dir("generated/license-source")

/**
 * Resolves the panomc.com license verification public key for build-time embedding.
 *
 * Property / env semantics (highest priority first):
 *   - `-PpanoLicensePublicKey=<base64|PEM>`  explicit override
 *   - `PANO_LICENSE_PUBLIC_KEY`             same when property unset
 *   - `-PlicenseServer=dev|prod|<url>`       auto-fetch from license server
 *   - `PANO_LICENSE_SERVER`                 same when property unset (e.g. CI)
 *   - (none)                                 empty key → plugin builds as FREE
 *
 * Result is cached under `build/license-key-cache/`.
 */
fun resolveLicensePublicKey(): String {
    val explicitProp = (panoLicensePublicKey ?: "").let(::stripPemAndWhitespace).takeIf { it.isNotEmpty() }
    val explicitEnv = System.getenv("PANO_LICENSE_PUBLIC_KEY")?.trim()?.takeIf { it.isNotEmpty() }
        ?.let(::stripPemAndWhitespace)?.takeIf { it.isNotEmpty() }
    val explicit = explicitProp ?: explicitEnv
    if (explicit != null) return explicit

    val serverProp = (project.findProperty("licenseServer") as String?)?.trim().orEmpty()
    val serverEnv = System.getenv("PANO_LICENSE_SERVER")?.trim().orEmpty()
    val server = serverProp.ifEmpty { serverEnv }
    if (server.isEmpty()) return ""

    val baseUrl = when (server.lowercase()) {
        "dev" -> "https://api-dev.panomc.com"
        "prod", "production" -> "https://api.panomc.com"
        else -> server.removeSuffix("/")
    }
    val cacheRoot = layout.buildDirectory.dir("license-key-cache").get().asFile
    cacheRoot.mkdirs()
    val cacheFile = cacheRoot.resolve(baseUrl.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".pem")

    if (!cacheFile.exists() || cacheFile.length() == 0L) {
        logger.lifecycle("Fetching license public key from $baseUrl...")
        val payload = try {
            URL("$baseUrl/platform/api/licenses/public-key")
                .openConnection()
                .apply {
                    connectTimeout = 10_000
                    readTimeout = 10_000
                    setRequestProperty("Accept", "application/json")
                }
                .getInputStream()
                .bufferedReader()
                .use { it.readText() }
        } catch (e: Exception) {
            throw GradleException(
                "Failed to fetch license public key from $baseUrl/platform/api/licenses/public-key: " +
                    "${e.message}. Either bring the license server up, drop the -PlicenseServer flag " +
                    "(builds the plugin as FREE), or set -PpanoLicensePublicKey=<base64> manually.",
                e
            )
        }
        cacheFile.writeText(payload)
    }
    return parsePublicKeyResponse(cacheFile.readText())
}

fun parsePublicKeyResponse(rawJson: String): String {
    val keyField = Regex("\"publicKeyBase64\"\\s*:\\s*\"([^\"]+)\"").find(rawJson)?.groupValues?.get(1)
    if (!keyField.isNullOrBlank()) return stripPemAndWhitespace(keyField)
    val pemField = Regex("\"publicKey\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
        .find(rawJson)?.groupValues?.get(1)
    if (!pemField.isNullOrBlank()) {
        val unescaped = pemField.replace("\\n", "\n").replace("\\\"", "\"").replace("\\\\", "\\")
        return stripPemAndWhitespace(unescaped)
    }
    throw GradleException(
        "License server response did not contain `publicKeyBase64` or `publicKey`. Got: ${rawJson.take(200)}"
    )
}

fun stripPemAndWhitespace(input: String): String =
    input
        .replace(Regex("-----BEGIN [^-]+-----"), "")
        .replace(Regex("-----END [^-]+-----"), "")
        .replace(Regex("\\s+"), "")

tasks {
    register("generatePluginBuildConstants") {
        val outputDir = premiumLicenseSrcDir
        val versionString = version.toString()
        val licenseServerInput = (project.findProperty("licenseServer") as String?) ?: ""
        val explicitKeyInput = (panoLicensePublicKey ?: "")

        outputs.dir(outputDir)
        // Cache invalidation triggers: any of these inputs changing forces re-generation.
        inputs.property("licenseServer", licenseServerInput)
        inputs.property("panoLicensePublicKey", explicitKeyInput)
        inputs.property("version", versionString)

        doLast {
            // Single-line Base64 SubjectPublicKeyInfo body or empty string for free builds.
            val cleanedPubKey = resolveLicensePublicKey()
            val file = outputDir.get().asFile
                .resolve("com/panomc/plugins/license/PluginBuildConstants.kt")
            file.parentFile.mkdirs()
            val escapedPubKey = cleanedPubKey
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
            file.writeText(
                """package com.panomc.plugins.license

internal object PluginBuildConstants {
    const val VERSION: String = "$versionString"
    const val PANO_PUBLIC_KEY_BASE64: String = "$escapedPubKey"
}
"""
            )
        }
    }

    register("installBun") {
        doLast {
            if (!bunBin.exists()) {
                println("🚀 Couldn't find Bun, downloading: $bunUrl")

                val zipFile = File(bunDir, "$bunPlatform.zip")
                zipFile.parentFile.mkdirs()

                URL(bunUrl).openStream().use { input ->
                    zipFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }

                copy {
                    from(zipTree(zipFile))
                    into(bunDir)
                }

                if (!isWindows) {
                    bunBin.setExecutable(true)
                }

                zipFile.delete()
                println("✅ Bun successfully downloaded: ${bunBin.absolutePath}")
            } else {
                println("✅ Bun is downloaded already: ${bunBin.absolutePath}")
            }
        }
    }

    register("buildUI", Exec::class) {
        dependsOn("installBun")
        println(bunBin.absolutePath)
        commandLine(bunBin.absolutePath, "run", "build")
    }

    register("zipPluginUI", Zip::class) {
        dependsOn("buildUI")

        from("src/main/resources/plugin-ui")
        archiveFileName.set("plugin-ui.zip")
        destinationDirectory.set(file("src/main/resources"))

        doLast {
            val pluginUIFolder = file("src/main/resources/plugin-ui")
            if (pluginUIFolder.exists()) {
                pluginUIFolder.deleteRecursively()
            }
        }

        outputs.upToDateWhen { false }
    }

    shadowJar {
        manifest {
            attributes["id"] = pluginId
            panoApiLevel?.let { attributes["api-level"] = it }
            attributes["name"] = pluginName
            pluginDescription?.let { attributes["description"] = it }
            attributes["pano-version"] = pluginPanoVersion
            attributes["main-class"] = pluginClass
            attributes["version"] = version
            attributes["developer"] = pluginDeveloper
            pluginLicense?.let { attributes["license"] = it }
            pluginSourceUrl?.let { attributes["source-url"] = it }
            pluginDependencies?.let { attributes["dependencies"] = it }
            pluginRequires?.let { attributes["requires"] = it }
            // Read by the host into PanoPluginDescriptor.freemium; see gradle.properties.
            pluginFreemium?.let { attributes["freemium"] = it }
        }

        archiveFileName.set("$pluginId-$version.jar")

        dependencies {
            exclude(dependency("io.vertx:vertx-core"))
            exclude {
                it.moduleGroup == "io.netty" || it.moduleGroup == "org.slf4j"
            }
        }
    }

    register("copyJar") {
        pluginsDir?.let {
            doLast {
                copy {
                    from(shadowJar.get().archiveFile.get().asFile.absolutePath)
                    into(it)
                }
            }
        }

        outputs.upToDateWhen { false }
        mustRunAfter(shadowJar)
    }

    jar {
        enabled = false
        dependsOn(shadowJar)
        dependsOn("copyJar")
    }
}

tasks.named("build") {
    if (!noui) {
        dependsOn("zipPluginUI")
    }
}

tasks.named("processResources") {
    if (!noui) {
        dependsOn("zipPluginUI")
    }
}

publishing {
    repositories {
        maven {
            name = pluginId
            url = uri("https://maven.pkg.github.com/$organization/$pluginId")
            credentials {
                username = project.findProperty("gpr.user") as String? ?: System.getenv("USERNAME_GITHUB")
                password = project.findProperty("gpr.token") as String? ?: System.getenv("TOKEN_GITHUB")
            }
        }
    }

    publications {
        create<MavenPublication>("shadow") {
            project.extensions.configure<com.github.jengelman.gradle.plugins.shadow.ShadowExtension> {
                artifactId = pluginId
                component(this@create)
            }
        }
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(11)) // Java 11 toolchain
    }
}

kotlin {
    jvmToolchain(11)
    sourceSets.named("main") {
        kotlin.srcDir(premiumLicenseSrcDir)
    }
}

// Both compileKotlin AND kaptGenerateStubsKotlin consume the generated sources, so wire
// the dependency on every Kotlin/kapt task that reads them. Plain `compileKotlin.dependsOn`
// alone makes Gradle 9 fail with implicit-dependency validation errors on kapt stubs.
tasks.matching { it.name == "compileKotlin" || it.name == "kaptGenerateStubsKotlin" }
    .configureEach { dependsOn("generatePluginBuildConstants") }

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
    }
}