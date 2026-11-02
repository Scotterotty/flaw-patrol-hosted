import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { signIn } from "./auth";
import { pickKind } from "./projects";

// ver_137, the six fixes before the team rollout (flow audit of ver_136):
// 1. Any run marked with a release counts toward it on Release status, and the column names its kind.
// 2. The invite page names who invited you and where, asks your name and signs you straight in.
// 3. Close run asks first when cases haven't been tested.
// 4. Viewers are left out of Assign lists.
// 5. No dead ends for Viewers.
// 6. Times on the viewer's own clock and Language setting, with no page errors.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const UMB = `Mobile ${TAG}`;
const HUB = `MH${TAG}`;
const IOS = `MI${TAG}`;
const AND = `MA${TAG}`;
const MIA = `mia.${TAG.toLowerCase()}@example.com`;
const VEE = `vee.${TAG.toLowerCase()}@example.com`;
const INV = `new.${TAG.toLowerCase()}@example.com`;
const UK = `uk.${TAG.toLowerCase()}@example.com`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const mia = await db.user.create({ data: { email: MIA, name: `Mia ${TAG}`, whatsNewSeen: 999 } });
    const vee = await db.user.create({ data: { email: VEE, name: `Vee ${TAG}`, whatsNewSeen: 999 } });
    const team = [
      { userId: admin.id, role: "ADMIN" as const },
      { userId: mia.id, role: "TESTER" as const },
      { userId: vee.id, role: "VIEWER" as const },
    ];
    const hub = await db.project.create({ data: { key: HUB, name: UMB, caseSeq: 3, members: { create: team } } });
    const group = await db.projectGroup.create({
      data: { name: UMB, hubProjectId: hub.id, platforms: [{ name: "iOS", suiteIds: [] }, { name: "Android", suiteIds: [] }], rolesChosenAt: new Date() },
    });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const cases = await Promise.all(
      ["Sign in", "Upload", "Share"].map((title, i) => db.testCase.create({ data: { projectId: hub.id, number: i + 1, title } })),
    );
    const cycle = (key: string, platform: string) =>
      db.project.create({ data: { key, name: `${UMB} ${platform} 2.1`, platform, rcName: "2.1", groupId: group.id, members: { create: team.map((m) => ({ ...m, fromUmbrella: true })) } } });
    const ios = await cycle(IOS, "iOS");
    await cycle(AND, "Android");
    // A Smoke test marked 2.1 on iOS: 1 of 3 tested, the rest Mia's.
    const run = await db.testRun.create({
      data: {
        projectId: ios.id,
        number: 1,
        name: "Smoke iOS",
        kind: "smoke",
        release: "2.1",
        createdById: admin.id,
        createdBy: "Demo Admin",
        entries: {
          create: cases.map((c, i) => ({
            caseId: c.id,
            caseVersion: 1,
            position: i,
            title: c.title,
            priority: "MEDIUM" as const,
            steps: [],
            assigneeId: mia.id,
            status: i === 0 ? ("PASSED" as const) : ("UNTESTED" as const),
            lastTestedAt: i === 0 ? new Date() : null,
          })),
        },
      },
    });
    Object.assign(ids, { group: group.id, hub: hub.id, ios: ios.id, run: run.id, admin: admin.id });
  } finally {
    await db.$disconnect();
  }
});

test("1. a Smoke test marked 2.1 counts on Release status, and the release box points to Start a run", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}/rc?release=2.1`);
  const ios = page.getByRole("region", { name: "iOS" });
  await expect(ios).toContainText("1 of 3 cases run");
  await expect(ios.getByTestId("rc-column-kind")).toHaveText("Smoke test R1");
  await expect(page.getByRole("region", { name: "Android" })).toContainText("No manual run yet");

  // The umbrella card follows the same rule.
  await page.goto("/");
  await expect(page.getByText(`2.1 · 0 of 2 done`).first()).toBeVisible();

  // Release candidate with a release that already has test cycles: Start a run instead, with Release filled in.
  await page.goto(`/g/${ids.group}`);
  await page.getByRole("button", { name: /Start a run/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Release candidate/ }).click();
  const rc = page.getByRole("dialog", { name: `Start a new release in ${UMB}` });
  await rc.getByLabel("Release", { exact: true }).fill("2.1");
  const note = rc.getByTestId("rc-release-exists");
  await expect(note).toHaveText(`${UMB} already has 2.1 test cycles for iOS and Android. To test in them, use Start a run and set Release to 2.1.Start a run instead`);
  await note.getByRole("button", { name: "Start a run instead" }).click();
  await pickKind(page, "Smoke test");
  const box = page.getByRole("dialog", { name: "Start a run" });
  await expect(box.getByLabel("Release", { exact: true })).toHaveValue("2.1");
  await expect(box.getByTestId("release-counts")).toHaveText("Counts toward 2.1 on Release status. Leave it blank to keep this run out.");
  await box.getByLabel("Release", { exact: true }).fill("");
  await expect(box.getByTestId("release-counts")).toHaveCount(0);
});

test("3 and 4. Close run asks first, and Viewers aren't in Assign lists", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${IOS}/runs/1`);
  await page.getByRole("checkbox", { name: `Select ${HUB}-2` }).first().check();
  const assign = page.getByLabel("Assign selected").first();
  await expect(assign.locator("option", { hasText: `Mia ${TAG}` })).toHaveCount(1);
  await expect(assign.locator("option", { hasText: `Vee ${TAG}` })).toHaveCount(0);
  // Filter by tester still lists everyone on the team.
  await expect(page.getByLabel("Filter by tester").locator("option", { hasText: `Vee ${TAG}` })).toHaveCount(1);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Close run" }).click();
  const ask = page.getByTestId("close-run-ask");
  await expect(ask).toContainText("2 of 3 cases haven't been tested.");
  await expect(ask).toContainText(`They come off Mia ${TAG}'s list and stay Untested in reports. You can reopen the run later.`);
  await ask.getByRole("button", { name: "Keep it open" }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Close run" }).click();
  await page.getByTestId("close-run-ask").getByRole("button", { name: "Close anyway" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  // Reopen, so it's back as it was.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Reopen run" }).click();
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(0);
});

test("5. a Viewer meets no dead ends", async ({ page }) => {
  await signIn(page, VEE, `Vee ${TAG}`);
  await page.goto(`/g/${ids.group}`);
  await expect(page.getByRole("link", { name: "Release status" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Import cases" })).toHaveCount(0);
  await page.goto(`/g/${ids.group}/runs`);
  await expect(page.getByRole("heading", { name: "Test runs" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start a run/ })).toHaveCount(0);
  await page.goto(`/g/${ids.group}/settings`);
  const cycles = page.getByTestId("cycle-settings");
  await expect(cycles.getByRole("button", { name: "View iOS 2.1" })).toBeVisible();
  await expect(cycles.getByRole("button", { name: /^Change / })).toHaveCount(0);
});

/** An invite link for someone with no name yet, the way Copy invite link makes one. */
async function inviteLink() {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: INV, whatsNewSeen: 999, memberships: { create: { projectId: ids.hub, role: "TESTER" } } } as never });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.passwordLink.create({ data: { userId: user.id, tokenHash, kind: "invite", createdById: ids.admin, expiresAt: new Date(Date.now() + 86_400_000) } });
    return token;
  } finally {
    await db.$disconnect();
  }
}

test("2. the invite names who and where, asks a name and signs you in", async ({ browser }) => {
  const token = await inviteLink();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/invite/${token}`);
  await expect(p.getByRole("heading", { name: `Demo Admin invited you to ${UMB}` })).toBeVisible();
  await expect(p.getByText("Your team sees this on runs, bugs and bashes.")).toBeVisible();
  await p.getByLabel("Choose a password").fill("new person pw 137");
  await p.getByLabel("Confirm password").fill("new person pw 137");
  // The name is required.
  await p.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(p).toHaveURL(/\/invite\//);
  await p.getByLabel("Your name").fill(`Nia ${TAG}`);
  await p.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(p).not.toHaveURL(/signin|invite/);
  await expect(p.locator('header button[aria-haspopup="menu"]')).toBeVisible();
  const db = new PrismaClient();
  try {
    expect((await db.user.findUniqueOrThrow({ where: { email: INV } })).name).toBe(`Nia ${TAG}`);
  } finally {
    await db.$disconnect();
  }
  await ctx.close();
});

/** Collects page errors such as React #418 (the page drew one thing on the server and another in the browser). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  return errors;
}

test("6. times on your own clock and Language setting, with no page errors", async ({ browser }) => {
  test.setTimeout(240_000);
  const zone = "America/Los_Angeles";
  // A Pacific browser while the server runs in UTC; an activity 2 hours ago.
  const at = new Date(Date.now() - 2 * 3600_000);
  const db = new PrismaClient();
  try {
    await db.user.create({ data: { email: UK, name: `Una ${TAG}`, isAdmin: true, spelling: "uk", whatsNewSeen: 999 } as never });
    await db.activityEntry.create({ data: { at, actorLabel: "Demo Admin", kind: "settings", action: `Clock check ${TAG}` } });
  } finally {
    await db.$disconnect();
  }
  const fmt = (locale: string) => `${at.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: zone })}, ${at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: zone })}`;

  for (const [email, name, locale] of [
    ["admin@example.com", "Demo Admin", "en-US"],
    [UK, `Una ${TAG}`, "en-GB"],
  ] as const) {
    const ctx = await browser.newContext({ timezoneId: zone });
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await signIn(page, email, name);
    await page.goto(`/workspace?days=1&q=${encodeURIComponent(`Clock check ${TAG}`)}#activity`);
    const row = page.getByRole("region", { name: "Activity log" }).getByRole("row").filter({ hasText: `Clock check ${TAG}` });
    await expect(row).toContainText(fmt(locale));
    // The report range ends today on the viewer's clock.
    await page.goto(`/g/${ids.group}/reports`);
    const today = new Date().toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: zone });
    await expect(page.locator("main")).toContainText(today);
    if (email === "admin@example.com") {
      for (const path of ["/account", "/workspace", `/p/${IOS}/runs/1`, `/p/${IOS}/runs/1/execute`, `/g/${ids.group}/settings`, `/p/${IOS}/reports/custom`]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
      }
      expect(errors).toEqual([]);
    }
    await ctx.close();
  }
});
