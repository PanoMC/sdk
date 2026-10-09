import java.util.Properties
import java.util.zip.ZipFile

plugins {
    kotlin("jvm") version "2.2.21"
}

version = "local-build"

val pluginId: String by project

// api-level (pano-api migrate-v1): "panoApiLevel" of the pano-web-platform tree this plugin is built in, else "current" from
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
val pluginPanoVersion: String by project

tasks {
    shadowJar {
        manifest {
            attributes["id"] = pluginId
            panoApiLevel?.let { attributes["api-level"] = it }
            attributes["name"] = pluginName
            attributes["pano-version"] = pluginPanoVersion
            attributes["version"] = version
        }

        archiveFileName.set("$pluginId-$version.jar")
    }
}
