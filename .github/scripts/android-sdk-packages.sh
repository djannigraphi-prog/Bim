#!/usr/bin/env bash
# Paquets lourds du SDK Android que la CI téléchargeait chez Google à chaque exécution (cause des échecs
# intermittents : archive tronquée, « Error on ZipFile unknown archive », 15/10/2026). Donne leurs chemins et les clés
# du cache GitHub, pour qu'ils ne soient téléchargés qu'une fois par version.
#  - NDK : version imposée par Flutter (android/app/build.gradle.kts : ndkVersion = flutter.ndkVersion), installée par
#    Gradle si absente ; absente des machines de GitHub pour la version actuelle (28.2.13676358).
#  - Image système de l'émulateur (paramètres du job android-e2e).
set -euo pipefail
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?SDK Android introuvable}}"
ndk=$(grep -rhoE 'ndkVersion[^"]*"[0-9]+\.[0-9]+\.[0-9]+"' "${FLUTTER_ROOT:?Flutter introuvable}/packages/flutter_tools/gradle/src/main" \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)
[ -n "$ndk" ] || { echo "::error title=paquets android::version du NDK de Flutter introuvable"; exit 1; }
api="${1:-34}"; target="${2:-google_apis}"; arch="${3:-x86_64}"
{
  echo "ndk_version=$ndk"
  echo "ndk_path=$sdk/ndk/$ndk"
  echo "ndk_key=android-ndk-$ndk-${RUNNER_OS}"
  echo "image_path=$sdk/system-images/android-$api/$target/$arch"
  echo "image_key=android-image-$api-$target-$arch-${RUNNER_OS}"
} | tee -a "$GITHUB_OUTPUT"
echo "Déjà présents sur la machine :"; ls -d "$sdk"/ndk/* "$sdk"/system-images/*/*/* 2>/dev/null || echo "aucun NDK ni image système"
