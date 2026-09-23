import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
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
val navigationKey = providers.gradleProperty("ANA_RUTAS_NAVIGATION_API_KEY").orNull?.trim().orEmpty()
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
        versionCode = 5
        versionName = "0.2.2"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SERVER_URL", "\"$driverServerUrl\"")
        buildConfigField("String", "NAVIGATION_API_KEY", "\"$navigationKey\"")
    }

    buildTypes {
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
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.google.android.libraries.navigation:navigation:7.9.0")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs_nio:2.1.5")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
