#!/usr/bin/env bash
# Publie les captures d'écran générées par la CI sur une branche dédiée (ajout d'un commit, jamais de réécriture).
# Branches séparées : main n'est jamais modifiée par la CI.
# Usage : publish-captures.sh [dossier] [branche] [description]
#   par défaut : captures Flutter (rendu de test) → « ci-captures » ;
#   job android-e2e : captures réelles de l'émulateur → « ci-captures-android ».
set -euo pipefail
src="${1:-$GITHUB_WORKSPACE/apps/mobile/test_captures/captures}"
branch="${2:-ci-captures}"
what="${3:-$(flutter --version | head -1)}"
[ -d "$src" ] || { echo "Aucune capture produite."; exit 1; }
work=$(mktemp -d)
cd "$work"
git init -q
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git fetch -q --depth=1 origin "$branch"; then git checkout -q -b "$branch" FETCH_HEAD; else git checkout -q --orphan "$branch"; fi
rm -rf captures && mkdir captures && cp "$src"/*.png captures/
printf 'Captures générées par la CI à partir du commit %s (%s).\n' "$GITHUB_SHA" "$what" > README.md
git add -A
git commit -q -m "Captures des écrans pour ${GITHUB_SHA}" || { echo "Captures inchangées."; exit 0; }
git push -q origin "$branch"
