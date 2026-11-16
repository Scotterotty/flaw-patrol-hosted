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
| Separate encryption key for saved tokens | `ENCRYPTION_KEY` in Vault (step 3, "Two keys") |
| Health endpoints | `/api/healthz` (liveness) and `/api/readyz` (readiness, runs `SELECT 1`) |
| Turn password sign-in off, SSO only | `AUTH_SSO_ONLY=true`, `AUTH_ADMIN_EMAILS`, Microsoft from Vault (step 3, "Company sign-in only") |
| Block internal addresses for Jira, Sentry and SSO (SSRF) | Built into the app; `OUTBOUND_ALLOW_HOSTS` for exceptions (below) |

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
  Start with 2 vCPU / 4 GB RAM / 50 GB SSD. Keep autovacuum on (the default); deleted
  videos leave space that `VACUUM` reclaims, so a weekly `VACUUM (ANALYZE) "Attachment"` in
  a quiet hour is a good idea once files pile up. PITR retention grows with these files too.
- The app reads attachment files a slice at a time (1 MB), never whole, so playing or
  scrubbing a video doesn't load the full file into the pod's memory.
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
| `AUTH_SECRET` | 32 random bytes: `openssl rand -base64 32`. Signs sign-in sessions. Moving data over from the old Docker server? Use **its** AUTH_SECRET for the first start (see "Two keys" below). |
| `ENCRYPTION_KEY` | 32 random bytes, made separately: `openssl rand -base64 32`. Encrypts saved Jira, GitHub, Qase, TeamCity, Sentry and Slack tokens. Back it up; never change it. |
| `AUTH_MICROSOFT_TENANT_ID` | The Entra ID directory (tenant) ID |
| `AUTH_MICROSOFT_ID` | The app registration's Application (client) ID |
| `AUTH_MICROSOFT_SECRET` | A client secret for that app registration. Note its expiry date. |

Passwords in the addresses must be URL-safe (letters and numbers are simplest).

### Two keys

- `AUTH_SECRET` only signs sign-in sessions. Changing it signs everyone out, and that's all.
- `ENCRYPTION_KEY` locks the tokens people save for Jira, GitHub and the rest. Changing or losing
  it means everyone pastes those tokens again, so keep it in Vault and never rotate it casually.
- Data copied from the old Docker server has tokens locked with that server's `AUTH_SECRET`.
  Start the new app once with the old `AUTH_SECRET` and the new `ENCRYPTION_KEY`: at start-up it
  moves every saved token over to `ENCRYPTION_KEY` (the log says "Re-sealed saved secrets with
  ENCRYPTION_KEY: ..."). After that, `AUTH_SECRET` can be changed freely.

### Company sign-in only

`deployment.yaml` sets `AUTH_SSO_ONLY=true`: nobody, admins included, can use a password.
The sign-in page shows only "Sign in with Microsoft", and password links, invite passwords and
the Password card on Your account are gone. Invites still work: the invite email's button leads
to the Microsoft button.

- **Microsoft app registration:** a Web platform redirect URI of
  `https://<your AUTH_URL host>/api/auth/callback/microsoft`, the `openid profile email`
  scopes, and a client secret (store it in Vault as above).
- **First admins:** put their emails in `AUTH_ADMIN_EMAILS`. They become workspace admins
  when they sign in. With it set, the first person to sign in is *not* made admin
  automatically (no race to sign up first).
- **Who may sign in:** people at `AUTH_ALLOWED_DOMAINS`, plus anyone added to a team.
- **Locked out?** There's no password back door. Fix the Microsoft settings in Vault, or
  add an admin's email to `AUTH_ADMIN_EMAILS`, and redeploy.

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

## Addresses the app may call (SSRF protection)

People type addresses for Jira, Sentry, TeamCity and company sign-in (OpenID Connect) into
the app's settings. The server only calls them when they are:

- `https://`, with no name or password in the address,
- on a public IP address. Loopback, private (10/8, 172.16/12, 192.168/16), link-local
  (169.254/16, including the cloud metadata server), carrier-grade NAT (100.64/10), IPv6
  private ranges, and names like `*.svc.cluster.local`, `*.internal`, `*.local` are refused,
- and, for Jira, a Jira Cloud site (`*.atlassian.net` or `*.jira.com`).

Redirects are never followed with a token attached. A saved token or client secret is only
reused for the same address; changing the address means pasting it again.

If a tool really lives inside the company network (say, a TeamCity server), list its host in
`OUTBOUND_ALLOW_HOSTS` (comma separated, e.g. `teamcity.magnopus.internal,10.20.0.15`).
As a second line of defence, an egress NetworkPolicy that blocks `169.254.169.254` and the
cluster's service range for this namespace is a good idea.

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
