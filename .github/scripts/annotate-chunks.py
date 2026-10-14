#!/usr/bin/env python3
"""Publie un fichier texte en plusieurs annotations GitHub (≈ 4 000 caractères chacune, 9 au plus),
pour lire la sortie d'un test via l'API quand les journaux ne sont pas téléchargeables."""
import sys
title, path = sys.argv[1], sys.argv[2]
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 9
text = open(path, encoding="utf-8", errors="replace").read()
chunks, cur = [], ""
for line in text.splitlines(True):
    if len(cur) + len(line) > 3800:
        chunks.append(cur); cur = ""
    cur += line
if cur:
    chunks.append(cur)
for i, c in enumerate(chunks[:limit]):
    esc = c.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
    print(f"::warning title={title} {i + 1}/{min(len(chunks), limit)}::{esc}")
