#!/usr/bin/env bash
# Publie les captures d'écran générées par la CI sur la branche « ci-captures » (ajout d'un commit, jamais de réécriture).
# Branche séparée : main n'est jamais modifiée par la CI.
set -euo pipefail
src="$GITHUB_WORKSPACE/apps/mobile/test_captures/captures"
[ -d "$src" ] || { echo "Aucune capture produite."; exit 1; }
work=$(mktemp -d)
cd "$work"
git init -q
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
if git fetch -q --depth=1 origin ci-captures; then git checkout -q -b ci-captures FETCH_HEAD; else git checkout -q --orphan ci-captures; fi
rm -rf captures && mkdir captures && cp "$src"/*.png captures/
printf 'Captures générées par la CI à partir du commit %s (%s).\n' "$GITHUB_SHA" "$(flutter --version | head -1)" > README.md
git add -A
git commit -q -m "Captures des écrans pour ${GITHUB_SHA}" || { echo "Captures inchangées."; exit 0; }
git push -q origin ci-captures
