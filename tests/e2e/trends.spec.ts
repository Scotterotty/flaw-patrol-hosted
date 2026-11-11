import { expect, test } from "@playwright/test";
import { openMoreDetails } from "./case-form";
import { openFilters } from "./filters";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `T${Date.now().toString(36).slice(-4).toUpperCase()}`;
const SHOTS = process.env.TREND_SHOTS;

test("trends chart results over time, and report filters can be saved for the team", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Trends ${KEY}`, KEY);
  for (const [title, priority] of [["Alpha", "CRITICAL"], ["Beta", "LOW"]]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await openMoreDetails(page);
    await page.getByLabel("Priority").selectOption(priority);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Both");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("button", { name: "Create a run" })).toBeVisible();
  const suiteUrl = page.url();

  // Two runs: Alpha passes then fails, Beta passes both times.
  for (const [release, alpha] of [["RC1", "Passed"], ["RC2", "Failed"]]) {
    await page.goto(suiteUrl);
    await page.getByRole("button", { name: "Create a run" }).click();
    await page.getByLabel(/Release/).first().fill(release);
    await page.getByRole("button", { name: "Create run", exact: true }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
    await page.getByRole("link", { name: "Start testing" }).click();
    for (const title of ["Alpha", "Beta"]) {
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      const verdict = title === "Alpha" ? alpha : "Passed";
      await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: verdict }).click();
      await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
    }
    await backToRun(page);
  }

  await page.goto(`/p/${KEY}/reports?view=trends`);
  await expect(page.getByRole("heading", { name: "Pass rate per day" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Results per period: 3 passed, 1 failed/ })).toBeVisible();
  const releases = page.locator("table").filter({ hasText: "Release" });
  await expect(releases.getByRole("row", { name: /RC1/ })).toContainText("100%");
  await expect(releases.getByRole("row", { name: /RC2/ })).toContainText("50%");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trends-light.png`, fullPage: true });

  // Trend-only filters narrow the results.
  await openFilters(page);
  await page.getByLabel("Priority").selectOption("CRITICAL");
  await expect(page.getByRole("img", { name: /Results per period: 1 passed, 1 failed/ })).toBeVisible();

  // Save it for the team; it appears as a chip that opens the same filters.
  // Retry the first click in case the page is still hydrating.
  await expect(async () => {
    await page.getByRole("button", { name: "Save this view…" }).click({ timeout: 1000 });
    await expect(page.getByLabel("View name")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("View name").fill("Critical trend");
  await page.getByRole("button", { name: "Save view" }).click();
  const chip = page.getByRole("region", { name: "Saved views" }).getByRole("link", { name: "Critical trend" });
  await expect(chip).toBeVisible();
  await page.goto(`/p/${KEY}/reports`);
  await chip.click();
  await expect(page).toHaveURL(/view=trends.*priority=CRITICAL/);
  await expect(page.getByLabel("Priority")).toHaveValue("CRITICAL");

  const csv = await page.request.get(`/p/${KEY}/reports/export?view=trends&range=all`);
  expect(await csv.text()).toContain("Release");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete saved view Critical trend" }).click();
  await expect(chip).toHaveCount(0);
});
