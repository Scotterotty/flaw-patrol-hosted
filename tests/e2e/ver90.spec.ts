import { PrismaClient } from "@prisma/client";
import { openFilters } from "./filters";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_90: Reports tell runs tested by hand from automated ones (two lines on
// Pass rate by run, a Runs filter, split tiles, a Type column), and runs started
// by picking exactly a suite's cases count as that suite's runs.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `AM${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({ data: { key: KEY, name: `Auto vs manual ${TAG}`, caseSeq: 2, runSeq: 3, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const cases = await Promise.all([1, 2].map((n) => db.testCase.create({ data: { projectId: project.id, number: n, title: `Case ${n} ${TAG}` } })));
    await db.testSuite.create({ data: { projectId: project.id, name: `Smoke ${TAG}`, cases: { create: cases.map((c, i) => ({ caseId: c.id, position: i })) } } });
    const runs = [
      { number: 1, name: "Hand pass", automated: false, statuses: ["PASSED", "FAILED"] },
      { number: 2, name: "junit.xml", automated: true, sourceFile: "junit.xml", statuses: ["PASSED", "PASSED"] },
      { number: 3, name: "Cart tests", automated: true, githubRunId: "999", githubRunNo: 12, statuses: ["PASSED", "PASSED"] },
    ] as const;
    for (const [k, r] of runs.entries()) {
      const { statuses, ...data } = r;
      const run = await db.testRun.create({ data: { projectId: project.id, state: "COMPLETED", createdAt: new Date(Date.now() - (5 - k) * 3_600_000), ...data } });
      for (const [i, c] of cases.entries()) {
        const e = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: c.priority, steps: [], status: statuses[i] } });
        await db.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: c.id, caseVersion: 1, status: statuses[i], stepResults: [], automated: r.automated } });
      }
    }
  } finally {
    await db.$disconnect();
  }
});

test("Reports split manual and automated runs, and picked suite cases count for the suite", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  await page.goto(`/p/${KEY}/reports`);
  await expect(page.getByText("Manual (tested by hand)")).toBeVisible();
  await expect(page.getByText("🤖 Automated (uploaded or pulled from GitHub)")).toBeVisible();
  await expect(page.getByText("1 manual", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("2 automated").first()).toBeVisible();
  const runsTable = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Release" }) });
  await expect(runsTable.getByRole("row").filter({ hasText: "Hand pass" })).toContainText("✋ Manual");
  await expect(runsTable.getByRole("row").filter({ hasText: "junit.xml" })).toContainText("🤖 Uploaded");
  await expect(runsTable.getByRole("row").filter({ hasText: "Cart tests" })).toContainText("🤖 GitHub");
  // None of these runs were started from the suite, but all ran exactly its cases.
  const suiteRow = page.getByRole("row").filter({ hasText: `Smoke ${TAG}` });
  await expect(suiteRow.getByRole("cell").nth(1)).toHaveText("3");

  // The Runs filter narrows every view and stays in the link.
  await openFilters(page);
  await page.getByRole("group", { name: "Runs" }).getByRole("link", { name: "🤖 Automated" }).click();
  await expect(page).toHaveURL(/runs=automated/);
  await expect(page.getByText("Hand pass")).toHaveCount(0);
  await expect(page.getByText("Manual (tested by hand)")).toHaveCount(0);
  await page.getByRole("link", { name: "Step results" }).click();
  await expect(page).toHaveURL(/runs=automated/);
  await expect(page.getByText("Hand pass")).toHaveCount(0);
  await page.getByRole("group", { name: "Runs" }).getByRole("link", { name: "✋ Manual" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Hand pass" })).toBeVisible();
  await expect(page.getByText("Cart tests")).toHaveCount(0);

  // A run of every case, which is exactly the suite, is linked to the suite when it starts.
  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByLabel("Run name").fill(`Picked ${TAG}`);
  await box.getByRole("button", { name: "Create run" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/4`));
  const db = new PrismaClient();
  try {
    const run = await db.testRun.findFirstOrThrow({ where: { project: { key: KEY }, number: 4 }, include: { suite: true } });
    expect(run.suite?.name).toBe(`Smoke ${TAG}`);
  } finally {
    await db.$disconnect();
  }
});
