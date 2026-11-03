# Production image: `next build` in one stage, `next start` (the standalone server)
# in a small final stage that runs as a non-root user. Set DATABASE_URL and
# AUTH_SECRET when running it; schema changes are applied on every start.
#   docker build -t flaw-patrol .
#   docker run -p 6767:6767 --env-file flaw-patrol.env flaw-patrol
# On a shared server behind nginx-proxy, use docker-compose.hosting.yml instead (README: Host it on a server).
# No demo data is loaded, so the first person to sign in becomes the admin.
# For local trials use `docker compose up`, which builds Dockerfile.dev instead.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Prisma's engines need OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/copy-trace-viewer.mjs ./scripts/
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && node scripts/copy-trace-viewer.mjs && npx next build

# Only the Prisma command line, to apply migrations at start (same version as the app's).
FROM base AS migrator
WORKDIR /migrator
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma.json
RUN npm init -y >/dev/null && npm install --no-audit --no-fund --omit=dev "prisma@$(node -p "require('/tmp/prisma.json').version")"

FROM base AS runner
ENV NODE_ENV=production PORT=6767 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 flawpatrol && useradd --system --uid 1001 --gid flawpatrol --no-create-home flawpatrol
COPY --from=build --chown=flawpatrol:flawpatrol /app/.next/standalone ./
COPY --from=build --chown=flawpatrol:flawpatrol /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/.prisma/client ./node_modules/.prisma/client
COPY --from=build /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=build /app/prisma/migrations ./prisma/migrations
COPY --from=migrator /migrator/node_modules /migrator/node_modules
COPY scripts/docker-start.sh ./docker-start.sh
USER flawpatrol
EXPOSE 6767
# Docker marks the app unhealthy when the sign-in page stops answering. The first start
# can take a minute while database changes apply, so checks wait 2 minutes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 6767) + '/signin').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Applies new database changes (through Neon's direct address), then starts the server.
CMD ["sh", "./docker-start.sh"]
