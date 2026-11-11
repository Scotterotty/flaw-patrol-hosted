import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_217: first-time experience, part B.
// 1. A private practice run: Try it on Start here, 3 sample cases, a PRACTICE note, Remove
//    practice run, gone on its own after 7 days, never in the umbrella, Jira, Slack or the log.
// 2. Bring your Google Sheet, results and all: Status, Tester and Notes come in as a finished
//    run "From my sheet", dated the day you pick.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `PB${TAG}`;
const CYCLE = `PW${TAG}`;
const NAME = `Part B ${TAG}`;
const EMPTY_HUB = `PE${TAG}`;
const MEMBER = `nina.${TAG.toLowerCase()}@example.com`;
const ids = { group: "", hub: "", cycle: "", admin: "", member: "", emptyGroup: "" };
const sheet = readFileSync(path.join(__dirname, "fixtures", "ftue-sheet.csv"));

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    ids.admin = admin.id;
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    ids.hub = hub.id;
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    ids.cycle = (await db.project.create({ data: { key: CYCLE, name: `${NAME} Web 1.0`, groupId: group.id, platform: "Web", rcName: "1.0", members: { create: { userId: admin.id, role: "ADMIN" } } } })).id;
    const member = await db.user.create({
      data: { email: MEMBER, name: "Nina Newcomer", whatsNewSeen: 999, memberships: { create: [{ projectId: hub.id, role: "TESTER" }, { projectId: ids.cycle, role: "TESTER", fromUmbrella: true }] } } as never,
    });
    ids.member = member.id;
    // An umbrella with no test cycles yet: the sheet's run makes the first one.
    const emptyHub = await db.project.create({ data: { key: EMPTY_HUB, name: `${NAME} empty`, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const emptyGroup = await db.projectGroup.create({ data: { name: `${NAME} empty`, hubProjectId: emptyHub.id } });
    ids.emptyGroup = emptyGroup.id;
    await db.project.update({ where: { id: emptyHub.id }, data: { groupId: emptyGroup.id } });
    // Start fresh: no practice run, Start here showing.
    await db.project.deleteMany({ where: { practiceFor: { in: [admin.id, member.id] } } });
    const me = await db.user.findUniqueOrThrow({ where: { id: admin.id }, select: { openCards: true } });
    await db.user.update({ where: { id: admin.id }, data: { openCards: me.openCards.filter((w) => !w.startsWith("first:")) } });
  } finally {
    await db.$disconnect();
  }
});

test("a practice run: try it, fail step 2 and report a bug, then remove it", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, MEMBER, "Nina Newcomer");
  await page.goto(`/g/${ids.group}`);
  const mine = page.getByTestId("member-start-here");
  const offer = mine.getByTestId("practice-offer");
  await expect(offer).toContainText("New here? Try a 2-minute practice run");
  await expect(offer).toContainText("3 sample cases. Only you see it. Not in reports.");
  // No run yet, so step 1 still says who starts one.
  await expect(mine.getByTestId("member-no-runs")).toBeVisible();

  await offer.getByRole("button", { name: "Try it" }).click();
  await expect(page).toHaveURL(/\/p\/TRY[A-Z]{3}\/runs\/1\/execute/, { timeout: 60_000 });
  const key = /\/p\/(TRY[A-Z]{3})\//.exec(page.url())![1];
  const banner = page.getByTestId("practice-banner");
  await expect(banner).toContainText("PRACTICE");
  await expect(banner).toContainText("Only you see this.");
  await expect(banner).toContainText("step 2 is meant to fail");

  // Case 1: pass step 1, fail step 2 and report it.
  await expect(page.getByRole("heading", { name: /Sign in with a sample account/ })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("It said Wrong password");
  await page.getByRole("button", { name: "Report bug", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Summary")).toHaveValue(/Wrong password/);
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: /Add an item to the cart/ })).toBeVisible();

  // It's private: no umbrella run, no activity, no Jira or Slack, and admins can't open it.
  const db = new PrismaClient();
  try {
    const p = await db.project.findUniqueOrThrow({ where: { key }, select: { id: true, practiceFor: true, groupId: true, slackMode: true } });
    expect(p).toMatchObject({ practiceFor: ids.member, groupId: null, slackMode: "off" });
    expect(await db.activityEntry.count({ where: { projectId: p.id } })).toBe(0);
    expect(await db.defect.count({ where: { projectId: p.id, externalKey: null } })).toBe(1);
    expect(await db.testRun.count({ where: { projectId: { in: [ids.hub, ids.cycle] } } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, "admin@example.com", "Demo Admin");
  const res = await admin.goto(`/p/${key}/runs/1`);
  expect(res?.status()).toBe(404);
  await admin.goto("/");
  await expect(admin.getByText("Practice run", { exact: true })).toHaveCount(0);
  await adminCtx.close();

  // Back on the Overview: Start here is still there (practice isn't a first result), with Continue.
  await page.goto(`/g/${ids.group}`);
  await expect(mine).toBeVisible();
  await expect(offer).toContainText("Your practice run");
  await expect(offer).toContainText("1 of 3 sample cases tested");
  await offer.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}/runs/1/execute`));

  // Remove practice run: everything goes, and you're back in your umbrella.
  await page.getByTestId("practice-banner").getByRole("button", { name: "Remove practice run" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${ids.group}`), { timeout: 60_000 });
  await expect(page.getByTestId("practice-offer")).toContainText("New here? Try a 2-minute practice run");
  const db2 = new PrismaClient();
  try {
    expect(await db2.project.count({ where: { key } })).toBe(0);
  } finally {
    await db2.$disconnect();
  }
});

test("a practice run goes away on its own after 7 days", async ({ page }) => {
  const db = new PrismaClient();
  const key = `TRZ${TAG.slice(0, 3)}`;
  try {
    await db.project.deleteMany({ where: { practiceFor: ids.admin } });
    await db.project.create({ data: { key, name: "Practice run", practiceFor: ids.admin, createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000), members: { create: { userId: ids.admin, role: "TESTER" } } } });
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto(`/g/${ids.group}`);
    await expect(page.getByTestId("admin-start-here").getByTestId("practice-offer")).toContainText("New here? Try a 2-minute practice run");
    expect(await db.project.count({ where: { key } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

test("a Google Sheet's Pass, Fail and Blocked come in as a finished run", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "Launch sheet.csv", mimeType: "text/csv", buffer: sheet });
  await expect(page.getByLabel("Where is this file from?").locator("option:checked")).toHaveText("Google Sheet");
  await expect(page.getByTestId("import-matched-count")).toHaveText("We matched 3 of your 6 columns.");
  await expect(page.getByTestId("import-not-matched")).toHaveCount(0);
  await expect(page.getByTestId("per-run-columns")).toContainText("Status, Tester and Notes are left out.");

  const card = page.getByTestId("sheet-results");
  await expect(card.getByRole("heading")).toHaveText("Your sheet has results for 4 of 5 cases");
  await expect(card.getByTestId("sheet-results-keep")).toBeChecked();
  await expect(card).toContainText(`The run goes in ${NAME} Web 1.0.`);
  await expect(card.getByTestId("sheet-results-how")).toHaveText("Notes become comments. Testers are matched to your team by name, or kept as the name in your sheet. Cases with no result are left out of the run.");
  await card.getByLabel("When were they tested?").fill("2026-11-09");

  await page.getByLabel("Don't use folders").check();
  await page.getByLabel(/Yes, we've run them before/).check();
  await page.getByRole("button", { name: "Import 5 cases" }).click();
  await expect(page.getByText("Imported 5 test cases")).toBeVisible({ timeout: 60_000 });
  const done = page.getByTestId("sheet-run-done");
  await expect(done).toContainText(`4 results from your sheet are in the finished run “From my sheet” in ${NAME} Web 1.0.`);
  await expect(page.getByTestId("sheet-results-link")).toHaveCount(0);
  await done.getByRole("link", { name: "See the run" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));

  const db = new PrismaClient();
  try {
    const run = await db.testRun.findFirstOrThrow({ where: { projectId: ids.cycle }, include: { results: { orderBy: { status: "asc" } } } });
    expect(run).toMatchObject({ name: "From my sheet", state: "COMPLETED" });
    expect(run.createdAt.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(run.results.map((r) => [r.status, r.testerName, r.comment, r.imported])).toEqual([
      ["PASSED", "Sam", "", true],
      ["PASSED", "Jo", "", true],
      ["FAILED", "Sam", "Count stayed at 0", true],
      ["BLOCKED", "Jo", "Promo service down", true],
    ]);
  } finally {
    await db.$disconnect();
  }
});

test("an umbrella with no test cycles makes one for the sheet's run", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${EMPTY_HUB}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "Launch sheet.csv", mimeType: "text/csv", buffer: sheet });
  const card = page.getByTestId("sheet-results");
  await expect(card.getByLabel("Name the test cycle it goes in")).toHaveValue(`${NAME} empty`);
  await card.getByLabel("Name the test cycle it goes in").fill(`${NAME} Launch`);
  await page.getByLabel("Don't use folders").check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 5 cases" }).click();
  await expect(page.getByTestId("sheet-run-done")).toContainText(`in ${NAME} Launch.`, { timeout: 60_000 });
  const db = new PrismaClient();
  try {
    const cycle = await db.project.findFirstOrThrow({ where: { groupId: ids.emptyGroup, name: `${NAME} Launch` }, select: { _count: { select: { runs: true } } } });
    expect(cycle._count.runs).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

test("untick the box and the sheet's results wait for Bring them into a run", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "Second sheet.csv", mimeType: "text/csv", buffer: sheet });
  await page.getByTestId("sheet-results").getByTestId("sheet-results-keep").uncheck();
  await expect(page.getByLabel("When were they tested?")).toHaveCount(0);
  await page.getByLabel("Don't use folders").check();
  await page.getByLabel(/Yes, we've run them before/).check();
  await page.getByRole("button", { name: "Import 5 cases" }).click();
  await expect(page.getByText("Imported 5 test cases")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("sheet-run-done")).toHaveCount(0);
});

// Readable in every look (4.5:1), light and dark: the practice offer and note, and the sheet results card.
const RULES = ["color-contrast", "aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "link-in-text-block", "heading-order", "target-size"];
const AXE = require.resolve("axe-core/axe.min.js");
const LOOK_IDS = ["classic", "mission", "hc", "white", "blue", "arcade", "retro"];
async function problems(page: import("@playwright/test").Page, within: string) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ([rules, sel]) => {
      // @ts-expect-error axe is added by the script tag
      const r = await window.axe.run(document.querySelector(sel) ?? document, { runOnly: { type: "rule", values: rules } });
      return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
    },
    [RULES, within] as const,
  );
}

test("the practice run passes the accessibility checks in every look, and fits a phone", async ({ page }) => {
  test.setTimeout(600_000);
  const db = new PrismaClient();
  await signIn(page, MEMBER, "Nina Newcomer");
  try {
    await page.goto(`/g/${ids.group}`);
    await page.getByTestId("practice-offer").getByRole("button", { name: "Try it" }).click();
    await expect(page).toHaveURL(/\/runs\/1\/execute/, { timeout: 60_000 });
    const runUrl = page.url();
    for (const look of LOOK_IDS) {
      for (const theme of ["light", "dark"]) {
        await db.user.update({ where: { id: ids.member }, data: { themeMode: theme, look } });
        await page.goto(`/g/${ids.group}`);
        await expect(page.getByTestId("practice-offer")).toBeVisible();
        expect(await problems(page, "[data-testid=member-start-here]"), `${look} ${theme} practice offer`).toEqual([]);
        await page.goto(runUrl);
        await expect(page.getByTestId("practice-banner")).toBeVisible();
        expect(await problems(page, "[data-testid=practice-banner]"), `${look} ${theme} practice note`).toEqual([]);
      }
    }
    // Phone: the note and step 1's buttons fit without sideways scrolling.
    await db.user.update({ where: { id: ids.member }, data: { themeMode: "light", look: "classic" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(runUrl);
    await expect(page.getByTestId("practice-banner").getByRole("button", { name: "Remove practice run" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: "test-results/ver217-practice-phone.png" });
    await page.goto(`/g/${ids.group}`);
    await page.screenshot({ path: "test-results/ver217-offer-phone.png" });
    await page.getByTestId("practice-offer").scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
  } finally {
    await db.user.update({ where: { id: ids.member }, data: { themeMode: "light", look: "classic" } });
    await db.project.deleteMany({ where: { practiceFor: ids.member } });
    await db.$disconnect();
  }
});

test("the sheet results card passes the accessibility checks in every look, and fits a phone", async ({ page }) => {
  test.setTimeout(600_000);
  const db = new PrismaClient();
  const before = await db.user.findUniqueOrThrow({ where: { id: ids.admin }, select: { look: true, themeMode: true } });
  await signIn(page, "admin@example.com", "Demo Admin");
  try {
    for (const look of LOOK_IDS) {
      for (const theme of ["light", "dark"]) {
        await db.user.update({ where: { id: ids.admin }, data: { themeMode: theme, look } });
        await page.goto(`/p/${HUB}/import`);
        await page.locator('input[type="file"]').setInputFiles({ name: "Launch sheet.csv", mimeType: "text/csv", buffer: sheet });
        await expect(page.getByTestId("sheet-results")).toBeVisible();
        expect(await problems(page, "[data-testid=sheet-results]"), `${look} ${theme} sheet results`).toEqual([]);
      }
    }
    await db.user.update({ where: { id: ids.admin }, data: { themeMode: "light", look: "classic" } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${HUB}/import`);
    await page.locator('input[type="file"]').setInputFiles({ name: "Launch sheet.csv", mimeType: "text/csv", buffer: sheet });
    await page.getByTestId("sheet-results").scrollIntoViewIfNeeded();
    await page.getByTestId("sheet-results").screenshot({ path: "test-results/ver217-sheet-phone.png" });
  } finally {
    await db.user.update({ where: { id: ids.admin }, data: { look: before.look, themeMode: before.themeMode } });
    await db.$disconnect();
  }
});
