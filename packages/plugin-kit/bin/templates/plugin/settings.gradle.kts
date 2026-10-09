// Auto-provisions the Java 11 toolchain the build targets, so contributors
// don't need a local JDK 11 — any JDK that can run Gradle is enough.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}
