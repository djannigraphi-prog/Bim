#!/usr/bin/env bash
# Démarre un serveur compatible S3 qui APPLIQUE les signatures et la confidentialité des compartiments
# (comme AWS), pour tester les photos privées. Essaie plusieurs serveurs ; le diagnostic est publié en annotation.
# Aucun repli vers un serveur permissif : si aucun ne démarre, l'étape échoue.
set -u
LOG="$RUNNER_TEMP/s3-start.log"
: > "$LOG"
ready() { for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' "$1" | grep -qE '^(200|403|400)$' && return 0; sleep 1; done; return 1; }
try() { # nom, url de santé, endpoint, clé, secret, commande docker…
  local name=$1 health=$2 endpoint=$3 key=$4 secret=$5; shift 5
  echo "== Essai : $name" | tee -a "$LOG"
  docker rm -f s3test >/dev/null 2>&1
  if ! docker run -d --name s3test "$@" >>"$LOG" 2>&1; then echo "   docker run a échoué" | tee -a "$LOG"; return 1; fi
  if ready "$health"; then
    echo "   prêt" | tee -a "$LOG"
    { echo "S3_TEST_ENDPOINT=$endpoint"; echo "AWS_ACCESS_KEY_ID=$key"; echo "AWS_SECRET_ACCESS_KEY=$secret"; } >> "$GITHUB_ENV"
    return 0
  fi
  echo "   pas prêt ; journaux :" | tee -a "$LOG"; docker logs s3test 2>&1 | tail -15 >> "$LOG"
  return 1
}
ok=1
try "MinIO (Docker Hub)" http://localhost:9000/minio/health/live http://localhost:9000 bimtest bimtest-secret-123 \
  -p 9000:9000 -e MINIO_ROOT_USER=bimtest -e MINIO_ROOT_PASSWORD=bimtest-secret-123 minio/minio:latest server /data && ok=0
[ $ok = 1 ] && try "MinIO (quay.io)" http://localhost:9000/minio/health/live http://localhost:9000 bimtest bimtest-secret-123 \
  -p 9000:9000 -e MINIO_ROOT_USER=bimtest -e MINIO_ROOT_PASSWORD=bimtest-secret-123 quay.io/minio/minio:latest server /data && ok=0
[ $ok = 1 ] && try "Versity S3 Gateway" http://localhost:7070/ http://localhost:7070 bimtest bimtest-secret-123 \
  -p 7070:7070 -e ROOT_ACCESS_KEY=bimtest -e ROOT_SECRET_KEY=bimtest-secret-123 versity/versitygw:latest --port :7070 posix /tmp && ok=0
[ $ok = 1 ] && try "Zenko CloudServer" http://localhost:8000/ http://localhost:8000 accessKey1 verySecretKey1 \
  -p 8000:8000 -e REMOTE_MANAGEMENT_DISABLE=1 zenko/cloudserver:latest && ok=0
python3 "$GITHUB_WORKSPACE/.github/scripts/annotate-chunks.py" "stockage S3 de test" "$LOG" 2
exit $ok
