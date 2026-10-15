#!/usr/bin/env bash
# Tests sur téléphones physiques (lot 2) : affiche l'adresse de l'API à donner au workflow « APK de test (téléphones) »
# et vérifie qu'elle répond. Aucun service externe, aucune dépense ; l'API doit tourner (cd apps/api && npm run start:dev).
# Usage : scripts/test-telephones.sh [port]
set -u
PORT="${1:-3000}"
ips=""
if command -v hostname >/dev/null && hostname -I >/dev/null 2>&1; then ips="$(hostname -I)"; fi
if [ -z "$ips" ] && command -v ipconfig >/dev/null; then ips="$(ipconfig getifaddr en0 2>/dev/null) $(ipconfig getifaddr en1 2>/dev/null)"; fi
echo "Adresses de cet ordinateur sur le réseau local : ${ips:-introuvables (voir les réglages réseau)}"
for ip in $ips; do
  case "$ip" in 127.*|*:*) continue ;; esac
  if curl -fsS --max-time 3 "http://$ip:$PORT/health" >/dev/null; then
    echo "OK : l'API répond sur http://$ip:$PORT  → adresse à saisir dans le workflow, et à tester depuis le navigateur du téléphone (/health)."
  else
    echo "Pas de réponse sur http://$ip:$PORT : l'API tourne-t-elle ? Le pare-feu autorise-t-il le port $PORT ?"
  fi
done
echo "Rappel : le service des rappels reste fermé ; les notifications se testent avec « Tests sur téléphone » dans l'écran Rappels."
