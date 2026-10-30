# Flaw Patrol

A test management app for a QA team: test cases, shared steps, versioned test
suites, step-by-step test runs, Jira bug reporting and reports. Milestones 1
(Foundation) and 2 (Execution) from the MVP plan are done.

## What's in milestone 1

- **Sign-in** with email and password, or Google or GitHub (Auth.js). Only invited people get in: the
  first person to sign in becomes workspace admin, after that a project admin
  adds people by email, or set `AUTH_ALLOWED_DOMAINS`. Since version 92, workspace admins set up
  Microsoft, Google or company SSO sign-in, invite emails and the activity log in Workspace settings
  (`/workspace`); `FP_MICROSOFT_AUTHORITY` only points Microsoft sign-in at the browser tests' mock.
- **Your profile** (any project's Settings tab, or click your name in the top
  bar): name, profile picture (shown on assignments, results and history),
  password, and appearance: light, dark or match the computer, six accent
  colors that also tint panels and grays (test statuses keep their own
  colors), and fonts: any of about 35 open-source fonts (including the Open Foundry
  collection, dyslexia-friendly and fun ones) for headings and for text
  separately, with Young Serif headings and Poppins text by default.
  An optional radio button (off by default) opens a station in a small window:
  ad-free SomaFM channels such as Fluid (lo-fi hip hop), KUSC, KJAZZ 88.1, or
  Pandora (your own stations, US only).
  Drag it by its grip (or use the arrow keys) to move it; double-click to reset.
  People can also add their own Spotify playlists, albums or podcasts (Share >
  Copy link) and play them in Spotify's player inside the radio. Premium
  listeners signed in to Spotify hear full songs; others get 30-second previews. Past versions and results show your new name.
- **Accessibility** (Your profile): text size from Small to Largest (scales the
  whole interface), stronger contrast, underlined links and reduced motion.
- **Mini game** (opt-in, in Your profile): XP for useful work (cases run, runs
  completed, bugs that got fixed, regressions caught, cases written by hand and
  improved, cases teammates ran, shared steps in use, suites that were run,
  working-day streaks), levels, and unlockable titles and picture frames shown
  next to your name. Worked out from the work itself (src/lib/xp.ts), no leaderboard
  (officially: five quick clicks on "leaderboard" in its description open the Bug of War leaderboard at /leaderboard).
  Players can also turn on quest maps (src/lib/quest.ts): every run gets a map
  generated from its id, the pawn moves a step per case result, and encounters
  and items (about 70, from Common to Exotic; longer runs, up to 50 cases, find
  rarer ones, and every map has at least one) stay hidden until the pawn lands on them, then go to whoever saved
  that case. The Quest map page shows your satchel and each teammate's
  (an admin XP reset or Go live empties them), the four latest past maps, and
  older quests in a collapsed, searchable list. Nothing is stored;
  it's all worked out from the run's results. Adds Quest map to the project menu.
  Seasonal maps (ver_98, src/lib/seasons.ts + src/components/quest-scenery.tsx) dress
  the scenery for spring, summer, fall, Halloween, winter and Winter lights, by the
  day the run started; Account → Mini game → Seasonal maps turns them off.
  Workspace admins get a Mini game admin card on Your account: reset one person's
  or everyone's XP, and Go live once (type GO LIVE), which restarts all XP and
  locks in the Early Adopter title for everyone who signed in before launch.
- **Projects page** that stays tidy as it grows. Star projects to keep them at
  the top; once there are more than six, a search box (press /) and a Recent
  row (the last three you opened) appear. Cards show active runs and when the
  project last had activity. Drag a card by its ⋮⋮ handle (or use its ⋯ menu)
  to put projects in your own order, and hide ones you don't need from your
  page. Admins can archive a finished project from the ⋯ menu or Settings (it
  moves to a collapsed Archived section and nothing is deleted), or delete it
  for good after typing its key. The RC status button lets you tick project
  cards and make the RC status report from just those.
- **Breadcrumbs** next to the logo (Projects › project › section › …).
- **Live runs.** Run pages and the runner check for changes every few seconds,
  so assignments and results show up for everyone. Testers can "Take this case"
  in the runner; a case someone else has taken is flagged. Unsaved input in the
  runner pauses the refresh.
- **Projects and roles.** Each project has a key (`SHOP`) that prefixes case IDs
  (`SHOP-12`). Roles per project:
  - Tester: writes and edits cases, inserts shared steps.
  - Lead: also manages folders and shared steps, imports and archives.
  - Admin: also manages members and settings.
- **Test case library.** Title, preconditions, numbered steps with expected
  results, priority, type (manual/automated), automation ID, tags, nested
  folders. Search by title, ID or automation ID; filter by priority, type, tag;
  bulk move and archive.
- **Version history.** Every save is a new immutable version with author, time
  and an optional note. Any version can be viewed, compared with the one before
  it, and restored (restoring creates a new version).
- **Shared steps.** Reusable blocks with `{{parameters}}`. Insert into any case
  and fill in values per case; editing the block updates every case using it.
  Select steps in a case and choose "Make shared step" to extract one. Each
  shared step lists where it's used and keeps its own version history. One level
  only (no shared steps inside shared steps) per the plan.
- **Import** from CSV or Excel (.xlsx) with column mapping and a preview.
  Handles steps in one cell (numbered or one per line), one row per step with a
  blank title (TestRail, Zephyr, Xray), and one row per step repeating the case
  ID (qTest). Folder paths like `Checkout / Payments` are created as needed.
  "Where is this file from?" (qTest, TestRail, Zephyr Scale, Xray) is picked
  from the column names and matches that tool's export exactly. For qTest it
  keeps the case key (shown as "was PQ-1708" and searchable), turns called test
  cases numbered 2.1, 2.2 that several cases share into shared steps with the
  same numbers, and can put back the line breaks qTest's CSV export drops.

## What's in milestone 2

- **Test suites.** Pick cases (search, folder, tag filters), order them, and
  save. Every change to a suite's cases saves a new **suite version** with an
  optional note. Each run records the suite version it ran and the **release
  candidate** it tested, and a suite's page lists every RC it has tested.
- **Test runs.** Start a run from a suite, from cases picked in the library, or
  as a "retest failed" copy of another run. A run snapshots each case's steps
  (shared steps expanded) so later edits never change what was run. Assign
  cases to testers, close and reopen runs.
  "Edit details" changes a run's name, release candidate, build, CSP version,
  environment or notes after it starts. A search box filters a run's cases (and
  the runner's list) by key or title. Tick cases on a run's page and "Run N selected" opens
  the runner on just those, in order.
- **Runner.** Mark each step Passed, Failed, Blocked, Retest or
  Skipped with one click or a key (P F B R S, arrows or J/K to move), note
  the actual result, attach files or paste screenshots, and Ctrl+Enter to save
  and open the next case. The case result follows the worst step unless you
  override it. A **Failed** step is where the runner offers to report or link
  the bug right there (ver_94 dropped the separate "Bug found" status).
  Step results, notes, bugs and files save as you go: leave a case half done
  and it shows **In progress** (with a Continue link) until its result is saved,
  and coming back picks up where you, or whoever was on it, left off.
  Beside the runner, **Execution history** shows the case's past runs as pips;
  click one for its step results, comments, files and bugs. **Bug still occurs**
  copies that run's step results and bugs into the current case in one click.
- **Jira.** An admin connects a Jira Cloud project in Settings (site, project
  key, account email and an API token from id.atlassian.com). From any step,
  "Report bug in Jira" files a bug with the steps to reproduce, expected and
  actual results and the step's screenshots filled in, or links an existing
  issue by search, key or URL. Jira statuses are shown on runs and the
  Defects page and refresh from Jira. Without Jira, defects are recorded here.
- **History.** Every result is kept. A case's page shows its execution history
  (which run, RC, version, tester, step outcomes, bugs) with a flaky marker.
- **Reports**, filtered by date, suite, release candidate or run, each with a
  CSV download: execution status per suite and run with a pass-rate trend;
  passed/failed step counts; failing steps (each step's pass/fail history
  across runs, fail rate, "failing N runs in a row" and linked bugs, with an
  "All time" range); defects found; case
  history (failing now, flaky); and results by tester. A Trends tab charts pass
  rate, results and bugs found per day, week or month (by the range) and per
  release candidate, and can also be narrowed by priority, tester, folder or tag.
  Saved views keep a named set of filters, shared with the project or private.

Not yet: GitHub and CI result uploads (milestone 3).

## Try it on your computer (no Docker)

Needs [Node 22](https://nodejs.org) and a Postgres database. A free
[Neon](https://neon.tech) database works: sign up, create a project, copy its
connection string.

1. Unzip the code and open a terminal in the unzipped `app` folder.
2. Run `node start.mjs` and paste the connection string when asked.
3. Open http://localhost:3000 when it says Ready, and sign in with your email.
   The first person to sign in becomes the admin.

Next time, just run `node start.mjs` again. Add `--demo` for a sample project.

To see how long the Umbrellas page takes to load, add `FP_TIMING=1` to `.env`
(or run `$env:FP_TIMING="1"` in PowerShell first) and start Flaw Patrol. Each
time the page loads, the terminal window prints how many milliseconds each step
took. Take the line out to turn it off.

## Try it on your computer (Docker only)

Needs only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Unzip the code and open a terminal in the unzipped folder.
2. Run `docker compose up --build`. The first run downloads and builds for a few minutes.
3. When the log says "Ready", open http://localhost:3000.
4. Sign in with your email (no password in this local mode). The first person to
   sign in becomes the admin. Create a project, then add cases or import a file.

Stop it with Ctrl+C. Your data is kept for next time; `docker compose down -v`
deletes it. To start with a sample project instead, set `SEED_DEMO: "true"` in
`docker-compose.yml`, then sign in as `admin@example.com`.

## Develop with Node 22

```bash
cp .env.example .env          # then set AUTH_SECRET: npx auth secret
docker compose up -d db       # or point DATABASE_URL at any Postgres 16
npm install
npx prisma migrate deploy
npm run db:seed               # optional: demo project SHOP with sample cases
npm run dev                   # http://localhost:3000
```

People sign in with their email and a password. Anyone who doesn't have a
password yet (newly invited people, and everyone from before passwords existed)
chooses one the first time they sign in. A project admin can make a one-time
"Password link" for a member who forgot theirs (Settings → Members); ten wrong
passwords lock an account for 15 minutes. Passwords are stored as scrypt
hashes. With the demo data, sign in as `admin@example.com`; `lead@example.com`
and `tester@example.com` show the other roles.

For Google sign-in create an OAuth client with redirect URI
`<site>/api/auth/callback/google`; for GitHub, an OAuth app with
`<site>/api/auth/callback/github`. Put the IDs and secrets in `.env`.

## Tests

```bash
npm test             # unit tests (Vitest): import parsing, steps, permissions, diff
npm run test:e2e     # browser tests (Playwright) against `next dev` and a mock Jira (tests/e2e/mock-jira.mjs)
npm run lint && npm run typecheck
npm run e2e:preflight  # 2-minute check before a full browser test run (below)
npm run e2e:all        # preflight, every browser test on a production build, the card check, then the 2 that need next dev
npm run check:cards    # every Umbrellas page card built the old way and the ver_100 way must match exactly
```

Before a full browser test run, `npm run e2e:preflight` stops with a plain message
if something would make every test fail. It closes old servers on the test ports
(3000, 3100, 3193 to 3199), checks `.env` (local database only, AUTH_SECRET set),
looks for button and label names the tests use that were renamed since the last
commit (`scripts/e2e-stale-names.mjs`), makes a brand-new database with every
migration and the demo data (named in `.e2e-database`, which Playwright then
uses), makes a production build (`--no-build` reuses the last one) and runs
`tests/e2e/smoke.spec.ts`. Run with `E2E_SERVER=prod` to test a production build
by hand; `run-sheet` and `ver82` need `next dev`.

`.github/workflows/ci.yml` runs all of these with a Postgres service once the
code is in a GitHub repository. Set `PW_CHROMIUM_PATH` to use an already
installed Chromium for the browser tests.

## Layout

```
prisma/schema.prisma     data model (cases, shared steps, suites, runs, results, defects, attachments, Jira)
prisma/seed.ts           demo data
src/auth.ts              Auth.js config and who may sign in
src/lib/                 pure logic: steps, csv-import, statuses, reports, Jira client and bug text (unit tested)
src/server/              server actions; every one checks the caller's project role
src/app/                 pages (Next.js App Router)
src/components/          UI, including the case editor and importer
tests/e2e/               Playwright tests
```

## Design notes

- Case steps are stored per version as JSON: plain steps, or a reference to a
  shared step by ID with parameter values. Runs snapshot the expanded steps and
  pin the case version, so edits never rewrite past results.
- Attachments are stored in Postgres (10 MB each) for now; move them to object
  storage when volumes grow. The Jira API token is encrypted with a key derived
  from `AUTH_SECRET`, so keep that secret stable, and give every copy that
  shares one database the same secret. When unzipping a new version, copy the
  old `.env` across (or paste the old AUTH_SECRET when `start.mjs` asks).
  `start.mjs` warns at startup if a saved token can't be read.
- The plan named tRPC for the app's internal API; milestone 1 uses Next.js
  server actions instead, which give the same end-to-end types with less code.
  The REST API for CI uploads comes with the GitHub milestone.
- UI components are a small hand-written set in the style of shadcn/ui
  (`src/components/ui.tsx`) rather than the generated library.
- The app is written in American English. People can read it in British
  English (Your account → Language, or the admin team default), which swaps
  words like color/colour as text is shown (`src/lib/spelling.ts`). Wrap app
  text that has American spellings in `<Sp>…</Sp>`, `useSpell()` or `spell()`;
  `spelling-coverage.test.ts` fails when a file shows such text without one.
  What people type is never changed. Dates follow the same choice.
