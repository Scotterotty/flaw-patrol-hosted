import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { makeTrendsUmbrella } from "./trends-umbrella";

// Hand testing shows as soon as it starts: Reports count cases In progress (started, not
// finished, never in a pass rate), and How testing is going's By run has bars for runs tested
// by hand next to the automated builds, with Both / Manual / Automated saved per person.

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

const visibleBox = (page: Page) => page.getByTestId("home-trends").filter({ visible: true });

/** A new RC 9 hand run on Web: 1 case finished, 2 started, 3 not started. */
async function startRc9() {
  const db = new PrismaClient();
  try {
    const cycle = await db.project.findUniqueOrThrow({ where: { key: `TRW${TAG}` } });
    const cases = await db.testCase.findMany({ where: { project: { key: `TR${TAG}` } }, orderBy: { number: "asc" } });
    const last = await db.testRun.count({ where: { projectId: cycle.id } });
    const run = await db.testRun.create({ data: { projectId: cycle.id, number: 100 + last, name: "RC 9 by hand", release: "RC 9" } });
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    for (const [i, c] of cases.entries()) {
      const status = i === 0 ? "PASSED" : i < 3 ? "IN_PROGRESS" : "UNTESTED";
      const entry = await db.runEntry.create({
        data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "MEDIUM", steps: [], status, ...(status === "IN_PROGRESS" ? { draftAt: i === 1 ? twoDaysAgo : new Date() } : {}) },
      });
      if (status === "PASSED") await db.testResult.create({ data: { entryId: entry.id, runId: run.id, caseId: c.id, caseVersion: 1, status, stepResults: [], testerName: "Demo Lead" } });
    }
    return run.number;
  } finally {
    await db.$disconnect();
  }
}

test("a hand run that has started shows in Reports and on By run", async ({ page }) => {
  test.setTimeout(240_000);
  const id = await makeTrendsUmbrella(TAG);
  await startRc9();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await signIn(page, "lead@example.com", "Demo Lead");

  // Reports: started cases count, outside the pass rate, and the "no manual testing" warning stays away.
  await page.goto(`/g/${id}/reports?release=${encodeURIComponent("RC 9")}`);
  await expect(page.getByTestId("started-banner")).toContainText("1 of 6 finished, 2 started but not finished");
  await expect(page.getByTestId("no-manual-banner")).toHaveCount(0);
  await expect(page.getByText("finished · 2 in progress")).toBeVisible();
  await expect(page.getByTestId("oldest-started")).toContainText(/2 d(ays)? ago/);

  // Overview → How testing is going → By run: hand runs get striped bars next to the builds.
  await page.goto(`/g/${id}`);
  const box = visibleBox(page);
  await box.getByRole("button", { name: "By run" }).click();
  await expect(box.getByTestId("build-bar").first()).toBeVisible();
  // Last 12 of each kind: 8 builds and the 12 newest of 17 hand runs.
  await expect(box.getByTestId("build-bar")).toHaveCount(8);
  await expect(box.getByTestId("manual-bar")).toHaveCount(12);
  await expect(box.getByTestId("manual-health")).toContainText("RC 9");
  await expect(box.getByTestId("manual-health")).toContainText("1 of 6 done · 2 in progress");
  await expect(box.getByTestId("by-run-note")).toContainText("never added together");

  // Manual only, remembered after a reload.
  await box.getByRole("button", { name: "✋ Manual" }).click();
  await expect(box.getByTestId("build-bar")).toHaveCount(0);
  await expect(box.getByTestId("manual-bar")).toHaveCount(12);
  await page.reload();
  await visibleBox(page).getByRole("button", { name: "By run" }).click();
  await expect(visibleBox(page).getByTestId("build-bar")).toHaveCount(0);
  await expect(visibleBox(page).getByTestId("manual-bar")).toHaveCount(12);

  // Folded, the one-line summary still says hand testing is under way.
  await visibleBox(page).getByTestId("trends-fold").click();
  await expect(visibleBox(page).getByTestId("trends-summary-manual")).toContainText("· 2 in progress");

  // Release status: the Web column says 2 in progress too.
  await page.goto(`/p/TRW${TAG}/reports/rc?release=${encodeURIComponent("RC 9")}`);
  await expect(page.getByTestId("rc-in-progress").first()).toContainText("2 in progress");
});
