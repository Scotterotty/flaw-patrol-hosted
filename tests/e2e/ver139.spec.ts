import { PrismaClient } from "@prisma/client";
import { openFilters } from "./filters";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_139: reports never compare people. No People tab, no Tester filter, no People part in
// custom reports; Priority, Folder and Tag on every tab instead, kept when you switch tabs.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `NP${TAG}`;
const NAME = `No people ${TAG}`;
const ids = { report: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 139 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({ data: { key: KEY, name: NAME, caseSeq: 2, runSeq: 1, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const steps = [{ number: "1", action: "Open the shop", expected: "It opens" }];
    const make = (number: number, title: string, priority: "HIGH" | "LOW", tags: string[]) =>
      db.testCase.create({ data: { projectId: project.id, number, title, tags, versions: { create: { version: 1, title, preconditions: "", priority, type: "MANUAL", tags, steps } } } });
    const pay = await make(1, `Pay by card ${TAG}`, "HIGH", ["checkout"]);
    const look = await make(2, `Change the theme ${TAG}`, "LOW", ["settings"]);
    const run = await db.testRun.create({ data: { projectId: project.id, number: 1, name: "Smoke", release: "RC 9" } });
    for (const [i, c] of [pay, look].entries()) {
      const status = i === 0 ? "FAILED" : "PASSED";
      const e = await db.runEntry.create({
        data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: i === 0 ? "HIGH" : "LOW", folderPath: i === 0 ? "Checkout" : "Settings", steps, status },
      });
      const r = await db.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: c.id, caseVersion: 1, status, testerName: "Demo Admin", stepResults: [{ status }] } });
      if (i === 0) {
        const d = await db.defect.create({ data: { projectId: project.id, number: 1, title: `Card declined ${TAG}`, severity: "PROBLEMATIC" } });
        await db.defectLink.create({ data: { defectId: d.id, resultId: r.id, stepIndex: 0 } });
      }
    }
    // A custom report saved before ver_139 that still lists the People part.
    ids.report = (
      await db.customReport.create({
        data: {
          projectId: project.id,
          name: `Old weekly ${TAG}`,
          parts: [
            { k: "part", id: "p1", part: "testers" },
            { k: "part", id: "p2", part: "cases.all" },
          ],
          createdById: admin.id,
          createdByName: "Demo Admin",
        },
      })
    ).id;
  } finally {
    await db.$disconnect();
  }
});

test("Reports have no People tab or Tester filter, and Priority stays picked across tabs", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/reports?range=all&view=trends`);
  const tabs = page.getByRole("navigation", { name: "Report views" });
  await expect(tabs.getByRole("link", { name: "Trends", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "People", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tester", { exact: true })).toHaveCount(0);

  // Bugs found gets Priority, Folder and Tag too.
  await tabs.getByRole("link", { name: "Bugs found", exact: true }).click();
  await expect(page).toHaveURL(/view=defects/);
  await openFilters(page);
  await page.getByLabel("Priority").selectOption("LOW");
  await expect(page).toHaveURL(/priority=LOW/);
  await expect(page.getByText(`Card declined ${TAG}`)).toHaveCount(0);
  await expect(page.getByTestId("report-summary-line")).toContainText("only Low priority cases");
  await page.getByLabel("Priority").selectOption("HIGH");
  await expect(page.getByText(`Card declined ${TAG}`)).toBeVisible();

  // Switching tabs keeps the pick.
  await tabs.getByRole("link", { name: "Case history", exact: true }).click();
  await expect(page).toHaveURL(/priority=HIGH/);
  await expect(page.getByLabel("Priority")).toHaveValue("HIGH");
  await expect(page.locator("#report-body").getByText(`Pay by card ${TAG}`).first()).toBeVisible();
  await expect(page.locator("#report-body").getByText(`Change the theme ${TAG}`)).toHaveCount(0);

  // Tag works on its own.
  await page.getByLabel("Priority").selectOption("");
  await page.getByLabel("Tag").selectOption("settings");
  await expect(page.locator("#report-body").getByText(`Change the theme ${TAG}`).first()).toBeVisible();
  await expect(page.locator("#report-body").getByText(`Pay by card ${TAG}`)).toHaveCount(0);

  // Session findings shows Tag only; Regression shows none, and the pick is still there after.
  await tabs.getByRole("link", { name: "Session findings", exact: true }).click();
  await expect(page.getByLabel("Priority")).toHaveCount(0);
  await tabs.getByRole("link", { name: "Regression", exact: true }).click();
  await expect(page.getByLabel("Tag")).toHaveCount(0);
  await tabs.getByRole("link", { name: "Case history", exact: true }).click();
  await expect(page.getByLabel("Tag")).toHaveValue("settings");
});

test("A custom report that had the People part opens without it and says so", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/reports/custom/${ids.report}?range=all`);
  await expect(page.getByTestId("people-part-removed")).toBeVisible();
  const body = page.locator("#custom-report-body");
  await expect(body.locator("section[data-part]")).toHaveCount(1);
  await expect(body.getByRole("heading", { name: "Every case executed" })).toBeVisible();
  const xlsx = await page.request.get(`/p/${KEY}/reports/export?format=xlsx&tabs=status,testers`);
  expect(xlsx.status()).toBe(200);
});
