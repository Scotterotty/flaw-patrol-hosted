#!/bin/sh
# The Docker image's start command (see Dockerfile): apply new database changes, then start Flaw Patrol.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "Flaw Patrol needs DATABASE_URL (the Postgres connection string). Put it in the settings file." >&2
  exit 1
fi
if [ -z "$AUTH_SECRET" ]; then
  echo "Flaw Patrol needs AUTH_SECRET. Use the same one as your other copies so saved Jira tokens keep working." >&2
  exit 1
fi

# Neon's pooled address ("-pooler") can't hold the lock that database changes need, and the start
# can get stuck there, so changes go through the direct address. The app itself is fine on either
# (start.mjs does the same).
MIGRATE_URL=$(printf '%s' "$DATABASE_URL" | sed 's/-pooler\././')
DATABASE_URL="$MIGRATE_URL" node /migrator/node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

exec node server.js
