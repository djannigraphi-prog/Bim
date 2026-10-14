#!/usr/bin/env bash
# Démarre un PostgreSQL 16 local SANS Docker (postes ou environnements où Docker n'est pas disponible).
# Méthode standard de l'équipe : `docker compose -f infra/docker-compose.yml up -d` (voir docs/INSTALLATION.md).
# Usage : scripts/local-postgres.sh start|stop|status
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PGDATA="${PGDATA:-$HOME/.bim-pgdata}"
PGPORT="${PGPORT:-5432}"
RUN_AS="${PG_RUN_AS:-postgres}"
run() { if [ "$(id -u)" = "0" ]; then su "$RUN_AS" -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      mkdir -p "$PGDATA"; [ "$(id -u)" = "0" ] && chown "$RUN_AS" "$PGDATA"
      run "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    run "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k /tmp' -l $PGDATA/server.log start -w >/dev/null"
    psql -h localhost -p "$PGPORT" -U postgres -tc "select 1 from pg_roles where rolname='bim'" | grep -q 1 \
      || psql -h localhost -p "$PGPORT" -U postgres -c "create role bim login createdb password 'bim'" >/dev/null
    psql -h localhost -p "$PGPORT" -U postgres -tc "select 1 from pg_database where datname='bim_dev'" | grep -q 1 \
      || psql -h localhost -p "$PGPORT" -U postgres -c "create database bim_dev owner bim" >/dev/null
    echo "PostgreSQL prêt : postgres://bim:bim@localhost:$PGPORT/bim_dev" ;;
  stop) run "$PGBIN/pg_ctl -D $PGDATA stop -m fast" ;;
  status) run "$PGBIN/pg_ctl -D $PGDATA status" ;;
esac
