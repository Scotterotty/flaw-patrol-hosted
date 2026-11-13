import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { openMoreDetails } from "./case-form";
import { backToRun, signIn } from "./auth";
import { standaloneProject } from "./projects";

// Scott, Nov 12: on "Pass rate, last 30 days" the "100%" label above the latest point was cut off
// at the chart's top edge (80s retrowave). The chart now has room above the 100% line, in every look
// and at phone width.
const KEY = `PL${Date.now().toString(36).slice(-3).toUpperCase()}`;
const EMAIL = "admin@example.com";
const SHOTS = process.env.PASS_RATE_SHOTS;
test.describe.configure({ mode: "serial" });

const withDb = async <T>(fn: (db: PrismaClient) => Promise<T>) => {
  const db = new PrismaClient();
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
};
test.afterAll(() => withDb((db) => db.user.update({ where: { email: EMAIL }, data: { look: "classic" } })));

test("the latest pass rate label on the Overview chart is never cut off, in every look and on phones", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, EMAIL, "Demo Admin");
  await standaloneProject(page, `Pass label ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Alpha");
  await openMoreDetails(page);
  await page.getByLabel("Step 1 action").fill("Do it");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("button", { name: "Create a run" })).toBeVisible();
  const suiteUrl = page.url();

  // A failed run three days ago, then a passed run today, so the latest point is 100%.
  for (const [release, verdict] of [["RC1", "Failed"], ["RC2", "Passed"]]) {
    await page.goto(suiteUrl);
    await page.getByRole("button", { name: "Create a run" }).click();
    await page.getByLabel(/Release/).first().fill(release);
    await page.getByRole("button", { name: "Create run", exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
    await page.goto((await page.getByRole("link", { name: "Start testing" }).getAttribute("href"))!);
    await expect(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
    await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: verdict }).click();
    await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
    await backToRun(page);
    if (release === "RC1") {
      const then = new Date(Date.now() - 3 * 86_400_000);
      await withDb((db) => db.testResult.updateMany({ where: { run: { project: { key: KEY } } }, data: { createdAt: then } }));
    }
  }

  const looks = ["classic", "mission", "hc", "white", "blue", "arcade", "retro"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const look of looks) {
      await withDb((db) => db.user.update({ where: { email: EMAIL }, data: { look } }));
      await page.goto(`/p/${KEY}`);
      const chart = page.getByRole("img", { name: "Pass rate per period, latest 100%" });
      await expect(chart).toBeVisible();
      const label = chart.locator("text", { hasText: /^100%$/ }).last();
      const [c, l] = [await chart.boundingBox(), await label.boundingBox()];
      expect(c && l, `${look} at ${width}px`).toBeTruthy();
      // The whole label sits inside the chart, not past its top edge.
      expect(l!.y, `${look} at ${width}px`).toBeGreaterThanOrEqual(c!.y);
      if (SHOTS && (look === "retro" || look === "classic")) await chart.screenshot({ path: `${SHOTS}/pass-rate-${look}-${width}.png` });
    }
  }
});
