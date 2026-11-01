import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_101: Custom reports. + Add to report on the Reports tabs, the Custom reports tab, the
// editor (tick parts, notes, rename, own filters), exports, and no Time logged on Testers.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `CR${TAG}`;
const CYCLE = `CC${TAG}`;
const NAME = `Reports ${TAG}`;
let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 101 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 3, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const steps = [{ kind: "step", action: "Open the shop", expected: "It opens" }];
    const cases = await Promise.all(
      ["Log in", "Buy a hat", "Refund"].map((title, i) =>
        db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps } } } }),
      ),
    );
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    const cycle = await db.project.create({ data: { key: CYCLE, name: `Web RC 1 ${TAG}`, groupId, platform: "Web", rcName: "RC 1", runSeq: 2, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    for (const n of [1, 2]) {
      const run = await db.testRun.create({ data: { projectId: cycle.id, number: n, name: `Pass ${n}`, release: "RC 1" } });
      for (const [i, c] of cases.entries()) {
        const status = i === 1 && n === 2 ? "FAILED" : "PASSED";
        const e = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: ["Log in", "Buy a hat", "Refund"][i], priority: "MEDIUM", steps: [{ action: "Open the shop", expected: "It opens" }], status } });
        await db.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: c.id, caseVersion: 1, status, testerName: "Demo Admin", elapsedSec: 300, stepResults: [{ status }] } });
      }
    }
  } finally {
    await db.$disconnect();
  }
});

test("Add to report from a tab, then edit it: tick parts, a note, rename, own filters, and export", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}/reports?range=all`);
  await page.getByTestId("add-status.passrate").click();
  await page.getByLabel("New report name").fill(`Weekly ${TAG}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("add-to-report-note")).toContainText(`Added to Weekly ${TAG}`);

  // The next box can go into the report just made.
  await page.getByRole("link", { name: "People", exact: true }).click();
  // No time logged on Testers (ver_101).
  await expect(page.getByRole("columnheader", { name: "Outcomes" })).toBeVisible();
  await expect(page.getByText("Time logged")).toHaveCount(0);
  await page.getByTestId("add-testers").click();
  await page.getByRole("menuitem", { name: new RegExp(`Weekly ${TAG}`) }).click();
  await page.getByTestId("add-to-report-note").getByRole("link", { name: "Open it" }).click();
  await expect(page.getByTestId("report-name")).toHaveText(`Weekly ${TAG}`);
  const body = page.locator("#custom-report-body");
  await expect(body.locator("section[data-part]")).toHaveCount(2);
  await expect(body.getByRole("heading", { name: "Pass rate by run" })).toBeVisible();
  await expect(body.getByRole("heading", { name: "People" })).toBeVisible();

  // Edit: tick Bug list, add a note, rename a part, give it its own filters.
  await page.getByTestId("edit-report").click();
  await expect(page).toHaveURL(/edit=1/);
  await page.getByRole("checkbox", { name: "Bug list" }).check();
  await expect(page.getByTestId("editor-slot")).toHaveCount(3);
  await page.getByRole("button", { name: "+ Add a note" }).click();
  await page.getByLabel("Note").fill("Refund still needs a look.");
  await page.getByLabel("Report name").click();
  await page.getByTestId("part-menu").first().click();
  await page.getByLabel("Heading").fill("How each run went");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("heading", { name: "How each run went" })).toBeVisible();
  await page.getByTestId("part-menu").nth(2).click();
  await page.getByLabel("Critical bugs only").check();
  await expect(page.getByTestId("own-filters")).toContainText("Critical only");
  await expect(page.getByText("All changes saved")).toBeVisible();
  await page.getByTestId("done-editing").click();
  await expect(page).not.toHaveURL(/edit=1/);
  await expect(body.locator("section[data-part]")).toHaveCount(4);
  await expect(body.getByText("Refund still needs a look.")).toBeVisible();
  await expect(body.getByRole("heading", { name: "How each run went" })).toBeVisible();

  // Exports.
  const url = new URL(page.url());
  for (const [format, type] of [
    ["pdf", "application/pdf"],
    ["xlsx", "spreadsheetml"],
  ]) {
    const res = await page.request.get(`${url.pathname}/export?format=${format}&by=1`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain(type);
  }

  // The list shows it, with the tabs its parts came from.
  await page.getByRole("link", { name: "← All custom reports" }).click();
  await expect(page.getByTestId("custom-report-card").filter({ hasText: `Weekly ${TAG}` })).toContainText("3 parts");
});

test("An umbrella's Custom reports tab: New report, tick By test cycle, Make a copy and Delete", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/reports`);
  await page.getByRole("link", { name: "Custom reports" }).click();
  await page.getByRole("button", { name: /New report/ }).click();
  await page.getByLabel("Report name").fill(`Umbrella ${TAG}`);
  await page.getByRole("button", { name: "Make report" }).click();
  await expect(page).toHaveURL(/edit=1/);
  await page.getByRole("link", { name: "All time" }).click();
  await page.getByRole("checkbox", { name: "By test cycle" }).check();
  await expect(page.getByTestId("editor-slot").getByText(`Web RC 1 ${TAG}`)).toBeVisible();
  await page.getByTestId("done-editing").click();
  await expect(page.getByTestId("report-name")).toHaveText(`Umbrella ${TAG}`);
  await expect(page.locator("#custom-report-body").getByText(`Web RC 1 ${TAG}`)).toBeVisible();

  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Make a copy" }).click();
  await expect(page.getByTestId("report-name")).toHaveText(`Umbrella ${TAG} (copy)`);
  await page.getByRole("button", { name: "⋯" }).click();
  await page.getByRole("menuitem", { name: "Delete report…" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/reports\/custom$/);
  await expect(page.getByTestId("custom-report-card")).toHaveCount(1);
});
