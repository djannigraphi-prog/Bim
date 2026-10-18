plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val bimDemo = System.getenv("BIM_DEMO") == "true"

android {
    namespace = "ci.bim.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        // Exigé par flutter_local_notifications (rappels programmés sur le téléphone).
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // Identifiant PROVISOIRE validé par le fondateur le 14/10/2026 ; à confirmer avant la publication (DECISIONS.md, D-APP-01).
        applicationId = "ci.bim.app"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Version de démonstration (BIM_DEMO=true, construite par la CI « demo-apk ») : http:// autorisé pour joindre
        // le serveur de démo sur le Wi-Fi local, identifiant distinct pour ne jamais remplacer l'app publiée.
        // Toute autre version publiée n'accepte que https.
        manifestPlaceholders["bimCleartext"] = if (bimDemo) "true" else "false"
        if (bimDemo) applicationIdSuffix = ".demo"
    }

    buildTypes {
        release {
            // Signature de production non configurée : elle sera ajoutée au moment de la publication,
            // avec une clé conservée hors du dépôt (jamais commitée). En attendant, clé de debug.
            signingConfig = signingConfigs.getByName("debug")
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

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}
