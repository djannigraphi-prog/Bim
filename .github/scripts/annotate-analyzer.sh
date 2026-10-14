#!/usr/bin/env bash
# Diagnostic : rend lisibles les problèmes de l'analyseur Dart sous forme d'annotations GitHub
# (consultables via l'API check-runs). N'altère pas le verdict : l'étape « flutter analyze » reste bloquante.
set -u
out=$(dart analyze --format=machine 2>&1 || true)
issues=$(printf '%s\n' "$out" | grep -E '^(ERROR|WARNING|INFO)\|' || true)
count=$(printf '%s' "$issues" | grep -c . || true)
echo "Problèmes signalés par l'analyseur : $count"
[ "$count" -eq 0 ] && exit 0
# Regroupe les problèmes par paquets de 25 dans une même annotation (limite de 10 annotations par niveau et par étape).
printf '%s\n' "$issues" | awk -F'|' -v root="$GITHUB_WORKSPACE/" '
  { f=$4; sub(root, "", f); line=sprintf("%s %s %s:%s:%s %s", $1, $3, f, $5, $6, $8);
    buf = (buf=="" ? line : buf "%0A" line); n++;
    if (n % 25 == 0) { print "::warning title=analyze " n "::" buf; buf="" } }
  END { if (buf!="") print "::warning title=analyze " n "::" buf }'
