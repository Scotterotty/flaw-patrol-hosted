import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { makeTrendsUmbrella } from "./trends-umbrella";

// Scott, Nov 9 2026: clicking a case under Flaky on an umbrella's Overview opened this week's
// Trends report instead. With few weeks on the chart, a week's invisible click area reached past
// the chart and covered the case lists. And that week's report said "No test runs match",
// because it only counted runs started that week, not older runs tested that week.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

const resetLead = async () => {
  const db = new PrismaClient();
  try {
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" }, select: { id: true, openCards: true } });
    await db.user.update({ where: { id: lead.id }, data: { openCards: lead.openCards.filter((w) => !w.startsWith("trends:")) } });
  } finally {
    await db.$disconnect();
  }
};
test.beforeEach(resetLead);
test.afterAll(resetLead);

test("A case in the Overview's case lists opens the case, not the chart's week", async ({ page }) => {
  test.setTimeout(120_000);
  const id = await makeTrendsUmbrella(TAG, { releases: 3 });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signIn(page, "lead@example.com", "Demo Lead");
  await page.goto(`/g/${id}`);
  const box = page.getByTestId("home-trends").filter({ visible: true });
  await box.getByRole("button", { name: "By week" }).click();
  // Every week's click area stays inside the chart.
  const chart = (await box.getByTestId("trends-chart").boundingBox())!;
  for (const p of await box.getByTestId("trends-point").all()) {
    const b = (await p.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(chart.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(chart.x + chart.width + 1);
  }
  await box.getByRole("tab", { name: /Keeps failing/ }).click();
  const link = box.getByTestId("trends-list-failing").getByRole("link").first();
  await link.click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/cases\/\d+/);
  await expect(page).not.toHaveURL(/reports/);
});

test("A week's report includes an older run that got results that week", async ({ page }) => {
  const db = new PrismaClient();
  const key = `FL${TAG}`;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const p = await db.project.create({ data: { key, name: `Flaky link ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const c = await db.testCase.create({ data: { projectId: p.id, number: 1, title: "Open a space" } });
    // Started three weeks ago, tested today.
    const run = await db.testRun.create({ data: { projectId: p.id, number: 1, name: `Old run ${TAG}`, createdAt: new Date(Date.now() - 21 * 86400_000) } });
    const entry = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: 0, title: c.title, priority: "MEDIUM", steps: [], status: "PASSED" } });
    await db.testResult.create({ data: { entryId: entry.id, runId: run.id, caseId: c.id, caseVersion: 1, status: "PASSED", stepResults: [], testerName: "Demo Admin" } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${key}/reports?from=${today}&to=${today}`);
  await expect(page.getByText("No test runs in this range")).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`Old run ${TAG}`) })).toBeVisible();
});
