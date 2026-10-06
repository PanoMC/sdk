// E2E-19 host fixture plugin (test only). Standalone build: compiles against the platform fat jar (-PpanoJar=<Pano-local-build.jar>),
// packs the UI bundle built by build.sh (resources/plugin-ui.zip) and writes build/libs/tc9-fixture-local-build.jar.
plugins {
    kotlin("jvm") version "2.2.21"
}

val panoJar = (project.findProperty("panoJar") as String?) ?: throw GradleException("pass -PpanoJar=<path to Pano-local-build.jar>")
val pluginVersion = "local-build"

repositories { mavenCentral() }

dependencies {
    compileOnly(files(panoJar))
    compileOnly(kotlin("stdlib"))
}

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

kotlin {
    sourceSets.named("main") { kotlin.srcDir("kotlin") }
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11) }
}

sourceSets.named("main") { resources.srcDir("resources") }

tasks.jar {
    archiveFileName.set("tc9-fixture-$pluginVersion.jar")
    manifest {
        attributes(
            "id" to "tc9-fixture",
            "name" to "TC-9 / PUI-2 host fixture (tests only)",
            "main-class" to "com.panomc.plugins.tc9fixture.Tc9FixturePlugin",
            "version" to pluginVersion,
            "pano-version" to "local-build",
            "developer" to "Pano"
        )
    }
}
