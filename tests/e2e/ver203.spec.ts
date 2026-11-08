import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_203: import and export are easy to find (audit of ver_200, approved Nov 7 2026).
// 1. A run's page has a gray Import / Export button; More keeps Edit, Close and Delete. Viewers see Export only.
// 2. On a phone, ▾ menus open inside the screen (the run page More menu used to open ~135px off the left edge).
// 3. Test runs: "Bring in results" is now "Import results".
// 4. Search finds Import cases and Export a run.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const UMB = `Checkout ${TAG}`;
const HUB = `IH${TAG}`;
const CYCLE = `IW${TAG}`;
const VIEWER = `vic.${TAG.toLowerCase()}@example.com`;
const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const vic = await db.user.create({ data: { email: VIEWER, name: `Vic ${TAG}`, whatsNewSeen: 999 } });
    const team = [
      { userId: admin.id, role: "ADMIN" as const },
      { userId: vic.id, role: "VIEWER" as const },
    ];
    const hub = await db.project.create({ data: { key: HUB, name: UMB, caseSeq: 2, members: { create: team } } });
    const group = await db.projectGroup.create({ data: { name: UMB, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }], rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const cases = await Promise.all(["Guest checkout", "Apply discount"].map((title, i) => db.testCase.create({ data: { projectId: hub.id, number: i + 1, title } })));
    const cycle = await db.project.create({
      data: { key: CYCLE, name: `${UMB} Web 2.1`, platform: "Web", rcName: "2.1", groupId: group.id, runSeq: 1, members: { create: team.map((m) => ({ ...m, fromUmbrella: true })) } },
    });
    await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "Smoke Web",
        kind: "smoke",
        createdById: admin.id,
        createdBy: "Demo Admin",
        entries: {
          create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM" as const, steps: [], status: i === 0 ? ("PASSED" as const) : ("UNTESTED" as const), lastTestedAt: i === 0 ? new Date() : null })),
        },
      },
    });
    ids.group = group.id;
  } finally {
    await db.$disconnect();
  }
});

/** The open menu's box is inside the screen, with nothing cut off on either side. */
async function insideScreen(page: Page) {
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const width = page.viewportSize()!.width;
  await expect.poll(async () => {
    const box = (await menu.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= width;
  }).toBe(true);
}

test("1. a run's page has Import / Export, and More keeps Edit, Close and Delete", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/runs/1`);
  await page.getByRole("button", { name: "Import / Export" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("link", { name: "Import results from a sheet" })).toHaveAttribute("href", `/p/${CYCLE}/runs/import?run=1`);
  await expect(menu.getByRole("link", { name: "Export to Excel (.xlsx)" })).toHaveAttribute("href", `/p/${CYCLE}/runs/1/export`);
  await expect(menu.getByRole("button", { name: "Export to a Google Sheet" })).toBeVisible();
  await expect(menu.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menu").getByRole("button", { name: "Edit details" })).toBeVisible();
  await expect(page.getByRole("menu").getByText(/Export|Import/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 3. Test runs says Import results.
  await page.goto(`/g/${ids.group}/runs`);
  await expect(page.getByRole("button", { name: "Import results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bring in results" })).toHaveCount(0);
});

test("2. on a phone, the run page menus open inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/runs/1`);
  await page.getByRole("button", { name: "Import / Export" }).click();
  await insideScreen(page);
  await expect(page.getByRole("menu").getByRole("link", { name: "Export to Excel (.xlsx)" })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More" }).click();
  await insideScreen(page);
  await page.keyboard.press("Escape");
  // Nothing scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("1. a Viewer sees Export, with no Import line and no More", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, VIEWER, `Vic ${TAG}`);
  await page.goto(`/p/${CYCLE}/runs/1`);
  await expect(page.getByRole("button", { name: "Import / Export" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("link", { name: "Export to Excel (.xlsx)" })).toBeVisible();
  await expect(menu.getByText("Import results from a sheet")).toHaveCount(0);
  await expect(menu.getByText("Export to a Google Sheet")).toHaveCount(0);
});

test("4. Search finds Import cases and Export a run", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" });
  const box = search.getByLabel("Search cases, runs, bugs, test cycles and pages");
  await box.fill("export run");
  await expect(search.getByRole("option", { name: /Export a run/ }).first()).toBeVisible();
  await box.fill("download results");
  await expect(search.getByRole("option", { name: /Export a run/ }).first()).toBeVisible();
  await box.fill("import");
  await expect(search.getByRole("option", { name: /Import cases/ }).first()).toBeVisible();
  await expect(search.getByRole("option", { name: /Import results from a spreadsheet/ }).first()).toBeVisible();
  await search.getByRole("option", { name: /Import cases/ }).filter({ hasText: UMB }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}/import`));
});
