#!/usr/bin/env python3
"""Extrait les tests en échec d'un rapport Jest (--json) vers un fichier texte court, pour les annotations."""
import json, re, sys
data = json.load(open(sys.argv[1]))
out = []
for f in data.get("testResults", []):
    if f.get("status") == "failed" and not f.get("assertionResults"):
        out.append(f"FICHIER {f['name']}: {re.sub(r'\x1b\[[0-9;]*m', '', f.get('message', ''))[:1500]}")
    for t in f.get("assertionResults", []):
        if t.get("status") == "failed":
            msg = re.sub(r"\x1b\[[0-9;]*m", "", "\n".join(t.get("failureMessages", [])))
            out.append(f"ÉCHEC {t.get('fullName')}\n{msg[:1500]}")
open(sys.argv[2], "w").write("\n\n".join(out) or "Aucun détail d'échec dans le rapport.")
