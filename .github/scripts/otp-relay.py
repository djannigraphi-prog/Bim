#!/usr/bin/env python3
"""Relais de codes pour le test Android de bout en bout (CI uniquement).

L'API de développement écrit les codes dans ses journaux (fournisseur « console », refusé en staging/production).
Ce petit serveur, lancé à côté de l'API dans la CI, lit ces journaux et rend le dernier code envoyé à un numéro,
pour que le test sur l'émulateur puisse le saisir comme le ferait une personne qui lit son SMS.
Il n'existe que dans la CI : l'API elle-même n'expose aucun code.
Usage : otp-relay.py <fichier-journal> <port>   →   GET /code?digits=<8 derniers chiffres> ou /code?to=<e-mail>
"""
import http.server, re, sys, urllib.parse

LOG, PORT = sys.argv[1], int(sys.argv[2])
ANSI = re.compile(r"\x1b\[[0-9;]*m")
LINE = re.compile(r"\[ENVOI FACTICE \w+\] → (\S+) : .*?ton code est (\d{6})")

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        digits = (q.get("digits") or [""])[0]
        to = (q.get("to") or [""])[0].lower()
        code = None
        with open(LOG, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = LINE.search(ANSI.sub("", line))
                dest = m.group(1).lower() if m else ""
                if m and ((digits and re.sub(r"\D", "", dest).endswith(digits)) or (to and dest == to)):
                    code = m.group(2)
        self.send_response(200 if code else 404)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write((code or "").encode())

    def log_message(self, *args):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
