plugins {
    kotlin("jvm") version "2.2.21"
}

version = "local-build"

val pluginId: String by project
val pluginName: String by project
val pluginPanoVersion: String by project

tasks {
    shadowJar {
        manifest {
            attributes["id"] = pluginId
            attributes["name"] = pluginName
            attributes["pano-version"] = pluginPanoVersion
            attributes["version"] = version
        }

        archiveFileName.set("$pluginId-$version.jar")
    }
}
