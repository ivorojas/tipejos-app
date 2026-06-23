plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tipejos.pet"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tipejos.pet"
        minSdk = 26          // Android 8.0 — necesario para TYPE_APPLICATION_OVERLAY y foreground services modernos
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        viewBinding = true
    }
    // Los sprite sheets ya están comprimidos; no recomprimir.
    androidResources {
        noCompress += listOf("png", "json")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.dynamicanimation:dynamicanimation:1.0.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
}
