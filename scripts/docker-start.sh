#!/bin/sh
# The Docker image's start command (see Dockerfile): apply new database changes, then start Flaw Patrol.
# In Kubernetes, set MIGRATE_ON_START=false: changes run in their own step before the app
# starts (scripts/docker-migrate.sh as an ArgoCD PreSync Job), and the app's own database
# login only needs to read and write rows, not change tables.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Flaw Patrol needs DATABASE_URL (the Postgres connection string). Put it in the settings file." >&2
  exit 1
fi
if [ -z "$AUTH_SECRET" ]; then
  echo "Flaw Patrol needs AUTH_SECRET. Use the same one as your other copies so saved Jira tokens keep working." >&2
  exit 1
fi

case "$MIGRATE_ON_START" in
  false|0|no|off) echo "Skipping database changes at start (MIGRATE_ON_START=$MIGRATE_ON_START)." ;;
  *) sh ./docker-migrate.sh ;;
esac

exec node server.js
