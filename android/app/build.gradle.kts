plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version of the yt-dlp wrapper library (https://github.com/yausername/youtubedl-android)
val youtubedlAndroid = "0.17.4"

android {
    namespace = "com.listeninglearner.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.listeninglearner.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // One smaller APK per processor type (arm for real phones, x86_64 for the PC emulator),
    // plus one "universal" APK that works everywhere
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
            isUniversalApk = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK can be installed directly.
            // For public distribution create your own key (README-ANDROID.md).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        // don't stop the build on style warnings
        checkReleaseBuilds = false
        abortOnError = false
    }

    packaging {
        // the bundled Python/yt-dlp binaries must be extracted on the phone
        jniLibs {
            useLegacyPackaging = true
        }
    }

    sourceSets {
        getByName("main") {
            // the web app is copied here from the main ListeningLearner folder at build time
            assets.srcDirs("build/generated/webassets")
        }
    }
}

// Copy the web app (index.html, css, js, icons) into the APK, so there is only one copy to edit.
val copyWebApp by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile) {
        include("index.html", "manifest.webmanifest", "css/**", "js/**", "icons/**")
    }
    into(layout.buildDirectory.dir("generated/webassets/www"))
}
tasks.named("preBuild") { dependsOn(copyWebApp) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.github.junkfood02.youtubedl-android:library:$youtubedlAndroid")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$youtubedlAndroid")
}
