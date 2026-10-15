#!/usr/bin/env python3
"""Résumé des requêtes reçues par l'API (CI) : méthode, adresse, statut et, pour un envoi, son type et sa taille.
Jamais les corps, les jetons ni les codes. Usage : api-requests.py <journal de l'API>"""
import json, re, sys

ANSI = re.compile(r"\x1b\[[0-9;]*m")
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = ANSI.sub("", line)
    if "request completed" not in line or "{" not in line:
        continue
    try:
        d = json.loads(line[line.index("{"):])
    except ValueError:
        continue
    req, res = d.get("req", {}), d.get("res", {})
    url = re.sub(r"/v1/media/[^?\s]+", "/v1/media/…", req.get("url", ""))
    out = f'{req.get("method")} {url} {res.get("statusCode")}'
    if req.get("method") in ("POST", "PUT", "PATCH"):
        h = req.get("headers", {})
        out += f' [{(h.get("content-type") or "").split(";")[0]} {h.get("content-length", "?")} o]'
    print(out)
