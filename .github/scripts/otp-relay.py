#!/usr/bin/env python3
"""Relais de codes pour le test Android de bout en bout (CI uniquement).

L'API de développement écrit les codes dans ses journaux (fournisseur « console », refusé en staging/production).
Ce petit serveur, lancé à côté de l'API dans la CI, lit ces journaux et rend le dernier code envoyé à un numéro,
pour que le test sur l'émulateur puisse le saisir comme le ferait une personne qui lit son SMS.
Il n'existe que dans la CI : l'API elle-même n'expose aucun code.
Usage : otp-relay.py <fichier-journal> <port> [dossier-captures]
  GET /code?digits=<8 derniers chiffres> ou /code?to=<e-mail>
  GET /shot?name=<nom>  →  capture réelle de l'écran de l'émulateur (adb screencap), enregistrée dans le dossier-captures.
  GET /ui-tap?text=<texte>[&shade=1][&wait=20]  →  touche un élément du système (fenêtre d'autorisation, action d'une
      notification) repéré dans l'arbre d'accessibilité (uiautomator) ; shade=1 ouvre d'abord le volet des notifications.
  GET /notifications[?min=1][&max=…][&wait=0]  →  notifications de BIM affichées par Android (dumpsys) : titre, texte, actions.
  GET /reminders-service?on=1|0  →  base de test de la CI uniquement : ouvre (ou referme) le service des rappels et retire
      les heures calmes par défaut, puis attend la fin du cache de l'API (31 s).
  GET /lockscreen-shot?name=<nom>  →  en une seule opération : active l'écran de verrouillage (glissement, sans code),
      éteint puis rallume l'écran, capture les notifications sur l'écran verrouillé, puis déverrouille. L'app ne dessine
      pas pendant ce temps : le test attend la réponse sans lui demander d'image.
  GET /resolve-reports  →  base de test de la CI uniquement : le « support » répond aux signalements ouverts.
  GET /reminder-soon?count=2&minutes=2  →  base de test de la CI uniquement : ajoute des tâches dans quelques minutes
      au dernier projet actif, pour recevoir un vrai rappel pendant le test.
Les captures montrent le rendu réel d'Android (polices et émojis du système, images chargées par le réseau).
"""
import datetime, html, http.server, json, os, re, shutil, subprocess, sys, time, urllib.parse

LOG, PORT = sys.argv[1], int(sys.argv[2])
SHOTS = sys.argv[3] if len(sys.argv) > 3 else None
NAME = re.compile(r"^[a-z0-9_]{1,60}$")


def adb():
    home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
    path = os.path.join(home, "platform-tools", "adb")
    return path if os.path.exists(path) else shutil.which("adb")
def run_adb(*args, timeout=30):
    return subprocess.run([adb(), *args], capture_output=True, timeout=timeout)


def psql(sql, *params):
    """Base de test de la CI (DATABASE_URL du job) ; jamais utilisé ailleurs."""
    cmd = ["psql", os.environ["DATABASE_URL"], "-v", "ON_ERROR_STOP=1", "-At", "-c", sql]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout.strip()


NODE = re.compile(r'<node [^>]*>')
ATTR = re.compile(r'(\w[\w-]*)="([^"]*)"')


def norm(t):
    return html.unescape(t).replace("\u2019", "'").casefold()


def ui_nodes():
    run_adb("shell", "uiautomator", "dump", "/sdcard/bim-ui.xml", timeout=40)
    xml = run_adb("exec-out", "cat", "/sdcard/bim-ui.xml").stdout.decode(errors="replace")
    nodes = []
    for raw in NODE.findall(xml):
        a = dict(ATTR.findall(raw))
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", a.get("bounds", ""))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            nodes.append((a.get("text", "") or a.get("content-desc", ""), (x1 + x2) // 2, (y1 + y2) // 2))
    return nodes


def bim_notifications():
    """Notifications de BIM affichées (dumpsys notification) : titre, texte et actions, dans l'ordre d'Android."""
    out = run_adb("shell", "dumpsys", "notification", "--noredact").stdout.decode(errors="replace")
    found, cur = [], None
    for line in out.splitlines():
        t = line.strip()
        if t.startswith("NotificationRecord("):
            cur = {"pkg": "ci.bim.app" in t, "title": "", "text": "", "actions": []}
            found.append(cur)
        elif cur is not None:
            m = re.match(r"android\.(title|text)=\w+ \((.*)\)$", t)
            if m:
                cur[m.group(1)] = m.group(2)
            m = re.match(r'\[\d+\] "(.*)" ->', t)
            if m:
                cur["actions"].append(m.group(1))
    # Une même notification peut figurer dans plusieurs sections du rapport (dont certaines sans contenu) :
    # on garde celles qui ont un titre, sans doublon.
    out, keys = [], set()
    for n in found:
        key = (n["title"], n["text"])
        if n["pkg"] and n["title"] and key not in keys:
            keys.add(key)
            out.append({k: v for k, v in n.items() if k != "pkg"})
    return out


def bim_notifications_raw():
    """Extrait brut du rapport d'Android autour des notifications de BIM (diagnostic en cas d'échec)."""
    lines = run_adb("shell", "dumpsys", "notification", "--noredact").stdout.decode(errors="replace").splitlines()
    keep = []
    for i, line in enumerate(lines):
        if "ci.bim.app" in line:
            keep.extend(lines[i:i + 25])
    return "\n".join(keep[:150])


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
        if (q.get("shade") or ["0"])[0] == "1":
            run_adb("shell", "cmd", "statusbar", "expand-notifications")
            time.sleep(2)
        with open(os.path.join(SHOTS, name + ".png"), "wb") as out:
            done = subprocess.run([tool, "exec-out", "screencap", "-p"], stdout=out, stderr=subprocess.PIPE, timeout=30)
        return self.reply(200 if done.returncode == 0 else 500, "ok" if done.returncode == 0 else done.stderr.decode(errors="replace"))

    def ui_tap(self, q):
        text = norm((q.get("text") or [""])[0])
        wait = int((q.get("wait") or ["20"])[0])
        shade = (q.get("shade") or ["0"])[0] == "1"
        seen = []
        end = time.time() + wait
        while time.time() < end:
            if shade:
                run_adb("shell", "cmd", "statusbar", "expand-notifications")
                time.sleep(1)
            nodes = ui_nodes()
            seen = [n[0] for n in nodes if n[0]]
            # Libellé exact d'abord (« Allow » et non « Don't allow »), sinon libellé qui contient le texte.
            exact = [n for n in nodes if text and norm(n[0]).strip() == text]
            partial = [n for n in nodes if text and text in norm(n[0])]
            for label, x, y in (exact or partial)[:1]:
                run_adb("shell", "input", "tap", str(x), str(y))
                return self.reply(200, label)
            # Notifications regroupées par Android (« BIM · 2 ») : on déplie le groupe pour voir les boutons.
            expand = [n for n in nodes if norm(n[0]) == "expand"]
            if expand:
                run_adb("shell", "input", "tap", str(expand[0][1]), str(expand[0][2]))
                time.sleep(1)
            time.sleep(1)
        return self.reply(404, "introuvable ; textes visibles : " + " | ".join(seen[:60]))

    def notifications(self, q):
        least = int((q.get("min") or ["0"])[0])
        most = int((q.get("max") or ["999"])[0])
        wait = int((q.get("wait") or ["0"])[0])
        end = time.time() + wait
        items = bim_notifications()
        while not (least <= len(items) <= most) and time.time() < end:
            time.sleep(3)
            items = bim_notifications()
        ok = least <= len(items) <= most
        if not ok:
            return self.reply(404, json.dumps(items, ensure_ascii=False) + "\n--- rapport d'Android ---\n" + bim_notifications_raw())
        return self.reply(200, json.dumps(items, ensure_ascii=False))

    def reminders_service(self, q):
        on = (q.get("on") or ["0"])[0] == "1"
        psql("UPDATE app_settings SET value = %s::jsonb WHERE key = 'notifications.reminders_enabled'" % ("'true'" if on else "'false'"))
        psql("UPDATE app_settings SET value = %s::jsonb WHERE key = 'notifications.quiet_hours'" % ("'null'" if on else "'{\"start\": \"22:00\", \"end\": \"06:00\"}'"))
        time.sleep(31)  # cache des réglages de l'API : 30 s
        return self.reply(200, "ouvert" if on else "fermé")

    def lockscreen_shot(self, q):
        name = (q.get("name") or [""])[0]
        if not SHOTS or not NAME.match(name):
            return self.reply(400, "capture impossible")
        # L'émulateur de la CI démarre sans écran de verrouillage : on active le simple glissement (sans code).
        run_adb("shell", "locksettings", "set-disabled", "false")
        run_adb("shell", "input", "keyevent", "KEYCODE_SLEEP")
        time.sleep(2)
        run_adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        time.sleep(3)
        state = run_adb("shell", "dumpsys", "window").stdout.decode(errors="replace")
        locked = any(k in state for k in ("isKeyguardShowing=true", "mShowingLockscreen=true", "mDreamingLockscreen=true", "KeyguardShowing=true"))
        os.makedirs(SHOTS, exist_ok=True)
        with open(os.path.join(SHOTS, name + ".png"), "wb") as out:
            subprocess.run([adb(), "exec-out", "screencap", "-p"], stdout=out, stderr=subprocess.PIPE, timeout=30)
        run_adb("shell", "wm", "dismiss-keyguard")
        time.sleep(2)
        run_adb("shell", "locksettings", "set-disabled", "true")
        run_adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        time.sleep(2)
        return self.reply(200, "verrouillé" if locked else "non verrouillé")

    def resolve_reports(self, q):
        n = psql(
            "WITH r AS (UPDATE project_reports SET status = 'resolved', resolution = 'Réponse de test de la CI.', "
            "resolved_at = now() WHERE status = 'open' RETURNING 1) SELECT count(*) FROM r"
        )
        return self.reply(200, n)

    def reminder_soon(self, q):
        count = int((q.get("count") or ["2"])[0])
        minutes = int((q.get("minutes") or ["2"])[0])
        # Heure d'Abidjan = UTC ; minute entière suivante + délai.
        at = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=minutes + 1)).strftime("%H:%M")
        for i in range(count):
            psql(
                "INSERT INTO project_tasks (id, project_id, title, time_of_day, weekdays, origin, sort_order) "
                "SELECT gen_random_uuid(), id, 'Rappel test %d', '%s', 127, 'user', 90 + %d FROM projects "
                "WHERE status = 'active' ORDER BY created_at DESC LIMIT 1" % (i + 1, at, i)
            )
        return self.reply(200, at)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/shot":
            return self.shot(q)
        if url.path == "/ui-tap":
            return self.ui_tap(q)
        if url.path == "/notifications":
            return self.notifications(q)
        if url.path == "/reminders-service":
            return self.reminders_service(q)
        if url.path == "/lockscreen-shot":
            return self.lockscreen_shot(q)
        if url.path == "/resolve-reports":
            return self.resolve_reports(q)
        if url.path == "/reminder-soon":
            return self.reminder_soon(q)
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
