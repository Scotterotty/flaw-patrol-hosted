#!/bin/sh
# Applies new database changes (Prisma migrations) and exits. Kubernetes runs this as its
# own step before the new version starts (an ArgoCD PreSync Job, deploy/kubernetes/), so a
# long change never holds up the app's start or trips its health checks.
#   docker run --rm --env-file flaw-patrol.env flaw-patrol sh ./docker-migrate.sh
# MIGRATE_DATABASE_URL is the database login that may change tables (the "migrator" role).
# Without it, DATABASE_URL is used (fine for the single-server Docker setup).
set -e

URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}"
if [ -z "$URL" ]; then
  echo "Database changes need MIGRATE_DATABASE_URL (or DATABASE_URL), the Postgres connection string." >&2
  exit 1
fi

# Neon's pooled address ("-pooler") can't hold the lock that database changes need, so
# changes go through the direct address. On any other database this changes nothing.
URL=$(printf '%s' "$URL" | sed 's/-pooler\././')
DATABASE_URL="$URL" exec node /migrator/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
