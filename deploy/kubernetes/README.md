# Flaw Patrol on Kubernetes: IT setup notes

**In plain words:** Flaw Patrol runs as one small web app plus one Postgres database.
Database changes run as their own step before each new version starts. Passwords and
keys live in Vault, not in files. This folder has the Kubernetes files; the steps below
are what IT does once.

These notes answer the "before deploying" list in the backend team's review
(`docs/reviews/flaw-patrol-review.md`, section 3 and "Suggested order").

| Review item | Where it's handled |
|---|---|
| Managed Postgres (Cloud SQL): private IP, TLS, backups, split roles | Steps 1 and 2, `docs/hosting/cloud-sql-roles.sql` |
| Migrations as an ArgoCD PreSync Job, not on app start | `migrate-job.yaml`, `MIGRATE_ON_START=false` in `deployment.yaml` |
| Secrets from Vault | `external-secret.yaml` (External Secrets Operator) |
| Single replica until uploads stop waiting on local disk | `deployment.yaml` (`replicas: 1`, `strategy: Recreate`) |
| Health endpoints | `/api/healthz` (liveness) and `/api/readyz` (readiness, runs `SELECT 1`) |

## 1. Cloud SQL for PostgreSQL

- PostgreSQL 16 or 17. No extensions needed.
- **Private IP only** (VPC peering / Private Service Connect to the GKE network). No public IP,
  and never an authorized network of `0.0.0.0/0`.
- **Require TLS:** set the instance to "Allow only SSL connections", and put `sslmode=require` in
  both database addresses (step 3).
- **Backups:** daily automated backups plus **point-in-time recovery** on. Prisma can't undo a
  database change, so PITR (or an on-demand backup right before a deploy) is the way back.
- **Size:** uploaded videos, screenshots and Playwright traces are stored in the database
  for now (up to 100 MB each), so give storage room to grow and turn on automatic storage increase.
  Start with 2 vCPU / 4 GB RAM / 50 GB SSD.
- A Cloud SQL Auth Proxy sidecar works too, if you prefer IAM over private IP. Then the
  addresses below point at `127.0.0.1:5432` and the proxy handles TLS.

## 2. The two database logins

Run `docs/hosting/cloud-sql-roles.sql` once as the `postgres` user. It makes:

- `flawpatrol_migrator`: owns the tables and may change them. Only the migrate Job uses it.
- `flawpatrol_app`: may read and write rows, nothing else. The app runs with this one.

It also sets default privileges, so every table a future migration creates is readable and
writable by the app role without anyone running GRANTs again.

## 3. Vault secrets

Store these under one Vault path (the example uses `flaw-patrol`) and point
`external-secret.yaml` at your ClusterSecretStore:

| Key | Value |
|---|---|
| `DATABASE_URL` | `postgresql://flawpatrol_app:PASSWORD@PRIVATE-IP:5432/flawpatrol?sslmode=require&connection_limit=10` |
| `MIGRATE_DATABASE_URL` | `postgresql://flawpatrol_migrator:PASSWORD@PRIVATE-IP:5432/flawpatrol?sslmode=require` |
| `AUTH_SECRET` | 32 random bytes: `openssl rand -base64 32`. Moving data over from the old Docker server? Use **its** AUTH_SECRET, or saved Jira/Sentry/Slack tokens stop working. |

Passwords in the addresses must be URL-safe (letters and numbers are simplest).

## 4. Build and publish the image

The repository's `Dockerfile` builds the production image (non-root, uid 1001). Build it in
your pipeline, push it to your registry, and set the tag in `kustomization.yaml`
(`images:`). The image tag should match the app version in `package.json`.

## 5. ArgoCD

Point an ArgoCD Application at `deploy/kubernetes/` (or an overlay of it). On each sync:

1. The **PreSync Job** (`migrate-job.yaml`) runs `docker-migrate.sh`, which applies any new
   database changes with the migrator login and exits.
2. Only if it succeeds, ArgoCD rolls out the app (`deployment.yaml`).

Change in `deployment.yaml` before the first sync:

- `AUTH_URL`: the address people will open, e.g. `https://flawpatrol.magnopus.global`.
- `AUTH_ALLOWED_DOMAINS`: email domains allowed to sign in.

Add an Ingress (or Gateway route) to the `flaw-patrol` Service with:

- TLS for the host in `AUTH_URL`.
- Request bodies up to **210 MB** (nginx ingress: `nginx.ingress.kubernetes.io/proxy-body-size: 210m`).
  Testers upload screen recordings.
- Read timeout of at least 120 seconds for those uploads.

## Why one replica

When someone attaches a video to a bug, the file waits on the pod's own disk (`/tmp`)
until they press Save. With two pods, Save might land on the other one, which doesn't
have the file. So:

- `replicas: 1`, and `strategy: Recreate` so a deploy never runs old and new side by side.
  Expect a few seconds of downtime per deploy.
- `/tmp` is an `emptyDir` with a 2 GiB limit, since the root filesystem is read-only.
- Memory limit 2 GiB, because uploads are held in memory while they arrive.

Moving uploads to a shared volume or a storage bucket (a later item in the review) lifts the
one-replica rule.

## Health checks

- `GET /api/healthz`: answers `{"ok":true}` while the server process runs. It never touches
  the database. Used for liveness and startup.
- `GET /api/readyz`: runs `SELECT 1` (3-second limit). `200 {"ok":true,"database":"ok"}`
  or `503 {"ok":false,"database":"unreachable"}`. Used for readiness. It never shows
  the database address or error text.

Neither needs sign-in, and neither returns any data.

## Running database changes by hand

```sh
kubectl -n flaw-patrol run fp-migrate --rm -it --restart=Never \
  --image=REGISTRY/flaw-patrol:TAG \
  --overrides='{"spec":{"containers":[{"name":"fp-migrate","image":"REGISTRY/flaw-patrol:TAG","command":["sh","./docker-migrate.sh"],"envFrom":[{"secretRef":{"name":"flaw-patrol-secrets"}}]}]}}'
```

## Moving data from the old Docker server

1. Stop the old app container (leave its database running).
2. `pg_dump -Fc --no-owner --no-acl` the old database.
3. `pg_restore --no-owner --role=flawpatrol_migrator -d flawpatrol` into Cloud SQL, signed in as `flawpatrol_migrator`.
4. Re-run the last four GRANT lines of `cloud-sql-roles.sql` (the restored tables need them).
5. Sync ArgoCD. The migrate Job applies whatever changes are newer than the copy.
