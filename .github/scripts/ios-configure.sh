#!/usr/bin/env bash
# Réglages de la partie iPhone de BIM : nom affiché et textes des autorisations demandées à l'utilisateur.
set -euo pipefail
dir="${1:-ios}"
plist="$dir/Runner/Info.plist"
pb=/usr/libexec/PlistBuddy
set_key() { "$pb" -c "Set :$1 $2" "$plist" 2>/dev/null || "$pb" -c "Add :$1 string $2" "$plist"; }
set_key CFBundleDisplayName "BIM"
set_key CFBundleName "BIM"
set_key NSCameraUsageDescription "BIM utilise l’appareil photo pour tes photos de projet, tes publications et les photos de tes articles."
set_key NSPhotoLibraryUsageDescription "BIM ouvre ta galerie pour choisir des photos et des vidéos à publier."
set_key NSMicrophoneUsageDescription "BIM utilise le micro pour enregistrer tes messages vocaux."
echo "Info.plist réglé :"
"$pb" -c "Print" "$plist" | grep -E "CFBundleDisplayName|Usage"
