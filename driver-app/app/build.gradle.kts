import java.net.URI
import java.util.Properties
import java.util.zip.ZipFile

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

// The same artifact supplies code and notices; no copied text or version drift.
val navigationDependency = "com.google.android.libraries.navigation:navigation:7.9.0"
val navigationLegalArtifact by configurations.creating {
    isCanBeConsumed = false
    isCanBeResolved = true
    isTransitive = false
}
abstract class ExtractNavigationNotices : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.NONE)
    abstract val artifacts: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty

    @TaskAction fun extract() {
        val destination = outputDirectory.get().asFile.resolve("navigation-notices")
        destination.mkdirs()
        ZipFile(artifacts.singleFile).use { archive ->
            val names = setOf("LICENSE", "LICENSES", "LICENSE.txt", "LICENSES.txt", "NOTICE", "NOTICE.txt")
            val entries = archive.entries().asSequence().filter { !it.isDirectory && it.name in names }.toList()
            check(entries.any { it.name.startsWith("LICENSE") }) { "Navigation SDK license is missing; do not distribute this build" }
            // Remove only stale generated notices from this task's own subdirectory.
            destination.listFiles()?.filter { it.isFile && it.name !in entries.map { entry -> entry.name } }?.forEach { check(it.delete()) }
            entries.forEach { entry ->
                archive.getInputStream(entry).use { input -> destination.resolve(entry.name).outputStream().use { output -> input.copyTo(output) } }
            }
        }
    }
}
val extractNavigationNotices = tasks.register<ExtractNavigationNotices>("extractNavigationNotices") {
    artifacts.from(navigationLegalArtifact)
    outputDirectory.set(layout.buildDirectory.dir("generated/navigation-notices/assets"))
}
androidComponents.onVariants { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(extractNavigationNotices, ExtractNavigationNotices::outputDirectory)
}

val driverServerUrl = providers.gradleProperty("ANA_RUTAS_SERVER_URL")
    .orNull
    ?.trim()
    ?.trimEnd('/')
    ?: error("ANA_RUTAS_SERVER_URL is required")
val driverServerUri = runCatching { URI(driverServerUrl) }
    .getOrElse { error("ANA_RUTAS_SERVER_URL must be a valid HTTPS origin") }
require(
    driverServerUri.scheme == "https" &&
        !driverServerUri.host.isNullOrBlank() &&
        driverServerUri.userInfo == null &&
        driverServerUri.path.isNullOrEmpty() &&
        driverServerUri.query == null &&
        driverServerUri.fragment == null,
) { "ANA_RUTAS_SERVER_URL must be an HTTPS origin without path or credentials" }
// Local keys never enter Git or silently follow a build to another backend.
// Explicit Gradle/environment properties override the local configuration.
val localNavigationKey = providers.fileContents(rootProject.layout.projectDirectory.file("navigation.local.properties"))
    .asText.map { text ->
        val configuration = Properties().apply { load(text.reader()) }
        require(configuration.getProperty("ANA_RUTAS_SERVER_URL") == driverServerUrl) {
            "Local navigation configuration belongs to another server; supply its own navigation key"
        }
        requireNotNull(configuration.getProperty("ANA_RUTAS_NAVIGATION_API_KEY")) {
            "Local navigation configuration is missing ANA_RUTAS_NAVIGATION_API_KEY"
        }
    }
val navigationKey = providers.gradleProperty("ANA_RUTAS_NAVIGATION_API_KEY")
    .orElse(localNavigationKey).orElse("").get().trim()
require(navigationKey.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
    "ANA_RUTAS_NAVIGATION_API_KEY contains invalid characters"
}

android {
    namespace = "com.five.anarutas.driver"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.five.anarutas.driver"
        minSdk = 26
        targetSdk = 36
        versionCode = 11
        versionName = "0.5.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SERVER_URL", "\"$driverServerUrl\"")
        buildConfigField("String", "NAVIGATION_API_KEY", "\"$navigationKey\"")
    }

    buildTypes {
        debug { enableUnitTestCoverage = true }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation(navigationDependency)
    add(navigationLegalArtifact.name, "$navigationDependency@aar")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
