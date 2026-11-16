> Copied from [magnopus/magnopus-agentic-dev-docs](https://github.com/magnopus/magnopus-agentic-dev-docs/tree/main/jelseth/flaw-patrol-review) (`jelseth/flaw-patrol-review/README.md`, commit `396da01`) on 2026-11-16. It reviews version 0.3.0-alpha.167; some findings may have been fixed since.

# flaw-patrol review

Repo: https://github.com/magnopus/flaw-patrol at `fa8f630` (v0.3.0-alpha.167), reviewed 2026-11-04.
Stack: Next.js 15.5.28, Auth.js `next-auth` 5.0.0-beta.32, Prisma 6.19.3, PostgreSQL 16/17, React 19. About 95k lines of TS/TSX.

**Bottom line:** usable as an internal tool once the deployment work in §3 is done. The real blockers are operational: it can't run as more than one replica, and it needs our first managed PostgreSQL, with large binary files stored inside the database.

The account-security flaws in §2 are real and should be fixed, but they are **not deal breakers** for an internal-only tool. Exploiting them takes a signed-in Magnopus employee acting in bad faith, every step is recorded in the app's activity log, and the blast radius is QA data rather than production systems. The one exception is the outbound-URL issue in H2: it lets the server reach internal cluster addresses, so it matters regardless of who the users are.

Findings marked ✅ were confirmed by reading the code path. The rest were reported by the reviewers and are plausible but not independently re-traced.

---

## 1. Standards fit (`chs-docs/07-code-style`)

None of the three style guides applies directly:
- `client-application.md` covers SpaceExplorer, which is vanilla JS with no framework.
- `dotnet-services.md` is for C# services.
- `python-processors.md` is for musubi.

flaw-patrol is a full-stack Next.js app with its own database. The principles that do carry over, and how it measures up:

| Principle (from our guides) | flaw-patrol |
|---|---|
| A single data-access layer; no module calls the API or DB directly | Partly. `src/lib/*-data.ts` and `src/server/*` exist, but pages also call `db` / `$queryRaw` directly (e.g. `src/app/p/[key]/cases/page.tsx:64,169`) |
| Permission wrapper around raw logic (the .NET three-tier pattern) | Yes. `requireProjectAction(projectId, action)` is used consistently, and a test (`authorization-rules.test.ts`) enforces that every action and route checks. The gaps are in *what* the permission model allows (§2) |
| Config-driven behaviour, not hard-coded types | Mixed. Migrations hard-code OKO/CSP data (`20261028090000_run_fields`, `20261030010001_ver96_data`) |
| Structured logs to stdout for Datadog | **Nice-to-have.** About 20 bare `console.*` calls and no structured logger. Plain stdout still reaches Datadog; a logger such as pino would just make it easier to search |
| Single responsibility, small modules | **Nice-to-have.** Some files are large (`runner.tsx` 1571 lines, `jira-settings.tsx` 1283, `server/jira.ts` 1271, `bash.tsx` 1229) and 903 lines are over 200 characters. Worth splitting when those files are next touched, not a blocker |
| "Use MCS, don't reinvent" (`use-mcs-first.md`) | This is a standalone app with its own auth, user store, file storage and email, so it doesn't apply in the strict sense. But we'd be running a parallel identity system and a blob store |

---

## 2. Security

### Critical / High

> **Internal-tool context.** The severities below are the technical ratings, as if the app faced the internet. Because flaw-patrol is internal-only, behind company SSO, and every user is an employee, C1 and H1 are effectively insider risks. Treat them as **fix soon, not block launch**: acceptable to deploy with them open, but they should go on the backlog with an owner. Mitigations in the meantime: keep password sign-in off so people sign in through SSO only, keep `AUTH_ALLOWED_DOMAINS` tight, and have someone glance at the activity log for password-link events. H2's SSRF half is the exception, because it is about what the *server* can reach inside the cluster, so block private address ranges before deploying to GKE/EKS.

**C1 ✅ Takeover of any non-admin account.**
- `src/server/umbrella.ts:88` lets anyone who isn't a Viewer everywhere create an umbrella, and `makeHub` (:51) makes them its ADMIN.
- `addMember` (`src/server/projects.ts:37`) upserts *any existing user* by email into that project, without the user's consent.
- `createPasswordLink` / `copyInviteLink` (`src/server/passwords.ts:89,139`) return a one-time reset/invite URL to the caller. The only guard (`memberFor`, :82) excludes workspace admins.
- `resetWithLink` (:189) overwrites `passwordHash` no matter which kind of link it was given, or whether the user already had a password.
- Result: any tester can set a new password for any colleague and sign in as them, inheriting every project that colleague is in.
- Fix:
  - Never return reset URLs to the caller; email them only to the address on file.
  - Refuse invite links for users who already have `passwordSetAt` or `lastLoginAt`.
  - Enforce `link.kind`.
  - Require consent before adding an existing user to a team.

**H1 Tester → Admin on someone else's project.**
- Moving a project into an umbrella needs only `project:group`, which is TESTER level (`src/lib/permissions.ts:82`).
- After the move, the umbrella's role rules and members (which the attacker controls) apply, and `syncUmbrellaMembers` copies hub admins into the project.
- Fix: moving a project requires ADMIN on the source project.

**H2 ✅ Leak of saved Jira/Sentry tokens and SSRF.**
- `saveJiraConfig` (`src/server/jira.ts:70-80`) reuses the stored token when the token field is blank but accepts a new `siteUrl`, then calls `client.check()`. This sends `Basic email:token` to any host.
- Sentry (`src/server/sentry.ts:45-72`) is the same, and `checkSentry` alone leaks the token without saving anything.
- The same fields, plus the OIDC issuer (`src/server/workspace.ts:100`), accept `169.254.169.254`, `*.svc.cluster.local` and so on. Error text echoes some of the response. In GKE this reaches the metadata server and internal services.
- Fix:
  - Require the token again whenever the host changes.
  - Allowlist `*.atlassian.net`.
  - Block private, link-local and loopback ranges and use `redirect: "manual"`. The Slack and Sheets URL checks already do this correctly.

### Medium

**⚠️ Warning (was H3): self-signup without email verification.** Low practical risk for an internal tool.
- `src/auth.ts:65-76` lets anyone create a password account for any address in `AUTH_ALLOWED_DOMAINS`, and SSO sign-ins later attach to that row by email (`admitUser`, :125).
- In theory someone could pre-claim a colleague's address before that colleague first signs in. In practice it needs a Magnopus insider, the app must be reachable to them, and the colleague would notice an account already exists.
- It goes away entirely if password sign-in is turned off (SSO only). Otherwise, the eventual fix is to verify email before activating a password account.

- **Unverified email trust.** `emailTrusted` (`src/lib/sign-in-rules.ts:17`) treats a missing `email_verified` as verified (generic OIDC, GitHub), and Microsoft uses `preferred_username` as the email. Sign-in links accounts by email. Fix: link by `(provider, sub)`.
- **Sessions aren't revoked.** JWT sessions (`auth.ts:146`, default 30 days) aren't revoked when the password is reset or changed. Add a session-version claim.
- **First password without re-auth.** SSO-only users can set a first password without re-authenticating (`passwords.ts:68`). That turns a stolen session into persistent access that survives SSO deprovisioning.
- **Same-origin trace viewer (plausible XSS).** The Playwright trace viewer is served from the app origin (`public/trace-viewer`) in an iframe without `sandbox` (`src/components/replay-frame.tsx:10`). It loads user-uploaded traces and any `?trace=` URL. Serve it from a separate origin or sandbox it.
- **Upload DoS.** Any signed-in user can POST 200 MB to `api/automation/stage`. It's buffered in memory several times, unpacked up to 500 MB, and written to `/tmp` for 24 h. Separately, `exceljs` loads a 10 MB xlsx with no unzipped-size limit (`src/server/spreadsheet.ts:19`), so a zip bomb can exhaust memory.
- **No security headers on pages.** No CSP, `frame-ancestors`/X-Frame-Options, HSTS or Referrer-Policy (`next.config.ts` has no `headers()`).

### Low
- **Sign-in throttling.**
  - Lockout is per account (10 failures → 15 min), which lets anyone keep a victim's account locked out by deliberately failing their sign-in.
  - There's no per-IP or global limit, so password spraying across many accounts is unthrottled.
  - `checkEmail` reveals whether an account exists.
- **Link origin from headers.** Invite, reset and Slack link origins come from `Origin` / `X-Forwarded-Host` when `AUTH_URL` is unset (`src/lib/invites.ts:17`, `src/lib/slack.ts:83`). Make `AUTH_URL` mandatory.
- **First-run admin race.** The first person to sign up becomes admin (`count()===0`, no lock). Bootstrap the admin from an env var instead.
- **Zip-slip in downloads.** `api/results/[id]/files` puts the user-supplied `fileName` into download zips. Apply `basename()` on upload.
- **XML entities.** `fast-xml-parser` runs with `processEntities: true` on uploaded JUnit XML (`src/lib/automation.ts:50`). Set it to false.
- **Non-expiring CI tokens.** CI tokens never expire, and the Qase webhook has no rate limit.
- **Encryption key tied to auth.** `AUTH_SECRET` is also the AES-GCM key for stored Jira, GitHub and Slack tokens. Rotating it silently breaks every integration. Split the key out.

### Vulnerable versions
- `npm audit --package-lock-only`: **0 advisories** (prod and dev), as of 2026-11-04. CI enforces this with `scripts/audit-check.mjs` plus an expiring allowlist, which is empty. Dependabot is on for npm, Actions and Docker.
- **Auth library is a beta.** `next-auth@5.0.0-beta.32` is a pre-GA auth library on a caret range.
- **Base image isn't pinned.** `node:22-bookworm-slim` is not pinned by digest.
- **Majors held back.** Next 16 and Prisma 7 majors are deliberately on hold in dependabot. Track them.

### What's solid
- **Passwords:** scrypt (N=2^15) with a salt and `timingSafeEqual`.
- **Tokens:** link and CI tokens use 32 / 30 random bytes stored as sha256, with expiry and one-time atomic use.
- **Encryption:** AES-256-GCM with a fresh IV.
- **SQL:** all `$queryRaw` calls are tagged templates; no `Unsafe` or `Prisma.raw`.
- **HTML:** no `dangerouslySetInnerHTML`, and email HTML is escaped.
- **Exports:** CSV and Sheets exports guard against formula injection.
- **Serving files:** attachments are served with `nosniff`, `CSP: default-src 'none'` and an allowlist of inline types.
- **Zip limits:** zip-bomb limits on the automation path.
- **API authorization:** every API route checks project membership; the IDOR checks on attachments, results and live data all pass.
- **Server actions:** they check permission and then scope by `{id, projectId}`, and inputs are zod-parsed, so no mass-assignment.
- **Redirects:** no open redirect.
- **Container user:** the production image runs as non-root (uid 1001).

---

## 3. Container and deployment

### PostgreSQL (we don't run any today)
- **Hard dependency on Postgres.** It uses `String[]` arrays, `unnest`, `= ANY()`, `FOR UPDATE`, enums and jsonb in migrations. Porting to MongoDB would be a rewrite. We'd need managed Postgres: Cloud SQL, since we're GKE-heavy, or RDS. No extensions are required.
- **Binary files are stored in Postgres (high).**
  - Three `bytea` columns: `User.avatar`, `Attachment.data` (videos and traces up to 100 MB), `FeedbackShot.data` (`prisma/schema.prisma:83,1018,1438`). The schema comment itself says "move to object storage when volumes grow."
  - ✅ `api/attachments/[id]/route.ts:16` loads the whole blob for every Range request, so scrubbing a video re-reads 100 MB each time. Several Jira paths `findMany` attachments without a `select` (`src/server/jira.ts:592,1109,1237`).
  - The result: backups dominated by blobs, TOAST bloat after deletes, and pod memory spikes.
  - Options, from least to most work:
    1. **Keep files in Postgres, but fix the read path.** Load attachment metadata with a `select` that leaves out `data`, and read only the requested byte range with `substring(data from X for N)`. Add the same `select` to the Jira `findMany` calls. This removes the memory spikes and is a small change. Backups stay large, so size Cloud SQL storage and PITR retention for it, and schedule `VACUUM` on `Attachment`.
    2. **Shared volume.** Write files to a ReadWriteMany volume (GCP Filestore on GKE, EFS on EKS) and keep only the path in Postgres. No new cloud APIs or credentials in the app, and the same volume also fixes the `/tmp` staging problem below. The cost is a Filestore/EFS instance to run and back up.
    3. **Object storage with signed URLs** (GCS, or S3 since we already run buckets per environment). Cleanest long-term: small database, cheap storage, downloads skip the app. Most code to change, and needs Workload Identity or IRSA for credentials.
  - Option 1 is enough to launch; 2 or 3 when volumes grow.
- **Roles and connection setup.**
  - Need: `sslmode=require` and an explicit `connection_limit` in `DATABASE_URL`. The Prisma default is `cpus*2+1` per pod (`src/lib/db.ts:5`).
  - Use the Cloud SQL Auth Proxy, or private IP plus VPC peering. Don't repeat the `0.0.0.0/0` mistake noted in `cloud-topology.md`.
  - Use a DDL-privileged migrator role and a DML-only app role.
  - Turn on PITR backups.
- **Migrations.**
  - Migrations run on every container start (`scripts/docker-start.sh:18`). Prisma's advisory lock prevents corruption, but long migrations block startup and fail probes. Move them to an ArgoCD PreSync Job and drop them from the entrypoint.
  - Very high schema churn: 83 migrations in about 16 days, 8 of them with embedded data rewrites. For example, `ver94` does `ALTER COLUMN TYPE` (full table rewrite under ACCESS EXCLUSIVE) and `crown_team` runs `DELETE FROM "Crown"`. Prisma has no down migrations, so snapshot before every deploy.
- **Missing foreign-key indexes.** `Attachment.projectId`, `DefectLink.resultId`, `SuiteCase.caseId`, `TestRun.suiteId`, `ProjectMember.userId`, `Folder.parentId`, `ActivityEntry.actorId` and others have no index. Cascade deletes, which are nearly universal, will seq-scan.
- **Neon-specific start script.** The `-pooler` sed in `docker-start.sh:17` is Neon-specific; on Cloud SQL it's a harmless no-op. It shows the app was built for "everyone runs a copy against one shared Neon DB" (`release/start.mjs`).

### Kubernetes / multi-replica
- **Staged uploads on local disk (high).** ✅ Uploads are staged on the pod's local disk (`src/lib/media-stage.ts:11`, `os.tmpdir()`) between upload and Save. With more than one replica, Save lands on a pod without the files. Run a single replica (or sticky sessions), stage onto a shared ReadWriteMany volume (Filestore/EFS), or move staging to object storage. With a read-only root FS, mount an `emptyDir` at `/tmp` with a `sizeLimit` of at least 1Gi.
- **Background work is lost on shutdown.** Digests, Slack, Qase sync and webhooks run in Next `after()` with no queue, and pending work is lost on SIGTERM. Set `terminationGracePeriodSeconds` to 30 or more and accept best-effort delivery.
- **Memory.** Request bodies of 80 MB (server actions) and 210 MB (middleware) are buffered in memory. Use a memory limit of at least 2Gi, and ingress/WAF body limits of at least 210 MB (nginx `client_max_body_size`).
- **Health check.** `HEALTHCHECK` hits `/signin`, which is a full server-side render and swallows DB errors. Add `/api/healthz` (liveness) and a readiness check that runs `SELECT 1`. Kubernetes ignores the Docker `HEALTHCHECK` anyway.
- **Rate limiting is replica-safe.** It's DB-backed (`CiTokenHit`). No in-memory caches were found.
- **Email.** Uses nodemailer/SMTP. Per `cloud-topology.md`, SES is our only email path, with no replacement plan.

### Compose / hosting file (if used as-is on a VM)
- **Postgres is published on the host.** `docker-compose.hosting.yml` exposes Postgres on **`5444:5432` on every host interface**, so it's reachable from outside unless the firewall blocks it. Bind it to `127.0.0.1:5444:5432` or remove it.
- **Dev defaults.** `docker-compose.yml` uses `postgres/postgres`, a fixed `AUTH_SECRET`, `AUTH_TRUST_HOST=true` and exposes 5432. That's fine for local use only. `Dockerfile.dev` runs as root with `next dev`.
- **Secrets in plain-text env files.** Secrets come from `flaw-patrol.env`. In Kubernetes they should come from Vault through External Secrets: `DATABASE_URL`, `AUTH_SECRET`, provider secrets.

---

## 4. General issues / enhancements
- **Maturity and ownership.** Alpha version (0.3.0-alpha.167). 56 of 59 commits are authored by "Claude", with one human contributor, and the history looks squashed or imported over about 3 days. Agree on an owner and code-review process before adopting it.
- **Non-QA features add attack surface.** Gamification, radio, Spotify embed, mini game, XP, crowns and quest gear add schema churn and third-party embeds. Put them behind a feature flag or remove them for an org deploy.
- **Lint is the default only.** Lint is `next/core-web-vitals` plus `next/typescript` with no extra rules. There are 35 `eslint-disable` / `@ts-ignore` / `as any` sites. `tsconfig` is `strict` (good).
- **Tests.** 85 vitest files and 123 Playwright specs, but CI runs only the e2e smoke spec by default.
- **CI.** Actions aren't pinned by SHA. No container image scan (Trivy/Grype), no image build in CI, no SBOM. Under our pipeline it would need a build-publish workflow, Kustomize manifests and an ArgoCD app (`deployment-pipeline.md` → "Adding a New Service").
- **Dead code and weight.** Legacy scripts (`scripts/*-before-ver*.ts`) and 35 `@fontsource` packages.

## Suggested order
1. **Before deploying:**
   - Deployment work: Cloud SQL (private IP, TLS, PITR, split roles), a PreSync migration Job, Vault secrets, a single replica until staging moves to a shared volume or object storage, and health endpoints.
   - Block private, link-local and loopback addresses for the Jira, Sentry and OIDC URLs (the SSRF half of H2).
   - Turn password sign-in off, so sign-in is SSO-only.
   - Fix the attachment read path (blob option 1 in §3) so video playback doesn't load whole files into memory.
2. **Backlog, soon after launch:** fix C1, H1 and the token-reuse half of H2 (account takeover, project takeover, saved-token leak). These are insider risks for an internal tool, not launch blockers.
3. Add security headers, sandbox or move the trace viewer, add upload rate and concurrency limits, and bound xlsx unzip size.
4. Add the missing FK indexes, and move blobs out of Postgres (shared volume or object storage) once volumes grow.
5. **Nice-to-haves:** structured logging, splitting the largest files, email verification for password signup (the old H3 warning).
