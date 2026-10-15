#!/usr/bin/env python3
"""Relais de codes pour le test Android de bout en bout (CI uniquement).

L'API de développement écrit les codes dans ses journaux (fournisseur « console », refusé en staging/production).
Ce petit serveur, lancé à côté de l'API dans la CI, lit ces journaux et rend le dernier code envoyé à un numéro,
pour que le test sur l'émulateur puisse le saisir comme le ferait une personne qui lit son SMS.
Il n'existe que dans la CI : l'API elle-même n'expose aucun code.
Usage : otp-relay.py <fichier-journal> <port> [dossier-captures]
  GET /code?digits=<8 derniers chiffres> ou /code?to=<e-mail>
  GET /shot?name=<nom>  →  capture réelle de l'écran de l'émulateur (adb screencap), enregistrée dans le dossier-captures.
Les captures montrent le rendu réel d'Android (polices et émojis du système, images chargées par le réseau).
"""
import http.server, os, re, shutil, subprocess, sys, urllib.parse

LOG, PORT = sys.argv[1], int(sys.argv[2])
SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
NAME = re.compile(r"^[a-z0-9_]{1,60}$")


def adb():
    home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
    path = os.path.join(home, "platform-tools", "adb")
    return path if os.path.exists(path) else shutil.which("adb")
ANSI = re.compile(r"\x1b\[[0-9;]*m")
LINE = re.compile(r"\[ENVOI FACTICE \w+\] → (\S+) : .*?ton code est (\d{6})")

class Handler(http.server.BaseHTTPRequestHandler):
    def reply(self, status, text):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(text.encode())

    def shot(self, q):
        name = (q.get("name") or [""])[0]
        tool = adb()
        if not SHOTS or not NAME.match(name) or not tool:
            return self.reply(400, "capture impossible")
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, name + ".png"), "wb") as out:
            done = subprocess.run([tool, "exec-out", "screencap", "-p"], stdout=out, stderr=subprocess.PIPE, timeout=30)
        return self.reply(200 if done.returncode == 0 else 500, "ok" if done.returncode == 0 else done.stderr.decode(errors="replace"))

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/shot":
            return self.shot(q)
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
