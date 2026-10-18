#!/bin/sh
# Démarre la démonstration BIM (Docker doit être lancé). Guide : docs/DEMO_TELEPHONE.md
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
export DEMO_PUBLIC_URL="http://${IP}:3000"
echo "Adresse à saisir dans l'app : ${DEMO_PUBLIC_URL}"
docker compose up -d --build
echo "Page de démo : http://localhost:3000/demo (environ 30 secondes au premier démarrage)"
(command -v open >/dev/null && sleep 30 && open http://localhost:3000/demo) || true
