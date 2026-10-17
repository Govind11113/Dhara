plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.dhara.greencredits"
    // Pinned ahead of flutter.compileSdkVersion (36): permission_handler_android
    // publishes AAR metadata requiring consumers to compile against 37. AGP
    // 9.0.1 only *recommends* 36, it does not cap it. targetSdk stays where
    // Flutter puts it — that one opts into new runtime behaviour.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.dhara.greencredits"
        // 23 is the floor required by flutter_secure_storage 11.x and ML Kit.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        multiDexEnabled = true
    }

    buildTypes {
        release {
            // Debug keys for now so `flutter build apk --release` works locally.
            // Replace with a real upload key before Play Store submission.
            signingConfig = signingConfigs.getByName("debug")
            // ML Kit and Appwrite reflection break under R8 full mode without
            // extra keep rules; leave shrinking off until release hardening.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
