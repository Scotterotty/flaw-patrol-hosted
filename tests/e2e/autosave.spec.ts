import { expect, test } from "@playwright/test";
import { signIn, backToRun } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `A${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("step results save as they're picked and are still there after leaving the case", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Autosave ${KEY}`, KEY);
  for (const [title, steps] of [
    ["Thing A", 5],
    ["Thing B", 1],
  ] as const) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    for (let i = 0; i < steps; i++) {
      if (i > 0) await page.getByRole("button", { name: "+ Add step" }).click();
      await page.getByLabel(`Step ${i + 1} action`).fill(`${title} step ${i + 1}`);
    }
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));

  // Pass two of Thing A's five steps, then go and test Thing B.
  await page.getByRole("row").filter({ hasText: "Thing A" }).getByRole("link", { name: "Test" }).click();
  await expect(page.getByRole("heading", { name: "Thing A" })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Passed" }).click();
  await expect(page.getByText("Step results saved")).toBeVisible();

  await page.goto(`/p/${KEY}/runs/1`);
  const rowA = page.getByRole("row").filter({ hasText: "Thing A" });
  await expect(rowA).toContainText("In progress");
  await page.getByRole("row").filter({ hasText: "Thing B" }).getByRole("link", { name: "Test" }).click();
  await expect(page.getByRole("heading", { name: "Thing B" })).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await expect(page).toHaveURL(/execute\?entry=|runs\/1$/);
  await expect(page.getByRole("heading", { name: "Thing B" })).toHaveCount(0);

  // Back on Thing A, the two passes are still there.
  await page.goto(`/p/${KEY}/runs/1`);
  await rowA.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByText("Picked up where you left off")).toBeVisible();
  await expect(page.getByText("2 of 5 steps have results")).toBeVisible();
  for (const n of [1, 2]) await expect(page.getByRole("group", { name: `Step ${n} status` }).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Step 3 status" }).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "false");

  // Finishing the case saves its result and clears In progress.
  await page.getByRole("button", { name: "Pass all remaining steps" }).click();
  await page.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await backToRun(page);
  await expect(rowA).toContainText("Passed");
  await expect(rowA).not.toContainText("In progress");

  // Reopening the finished case shows its saved step results, not blank steps.
  await rowA.getByRole("link", { name: "Retest" }).click();
  await expect(page.getByText("Its step results are shown below.")).toBeVisible();
  for (const n of [1, 2, 3, 4, 5]) await expect(page.getByRole("group", { name: `Step ${n} status` }).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  // Saving without changes keeps the one result rather than adding a copy, and stays on the case.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1/execute\\?entry=`));
  await page.goto(`/p/${KEY}/cases/1`);
  await expect(page.getByRole("row").filter({ hasText: "Passed" })).toHaveCount(1);
});
