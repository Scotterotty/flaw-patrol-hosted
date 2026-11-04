import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_107: import asks whether the cases were run before. Brand new ones get a readable
// New banner on the run page (no All/New switch when every case is new) that can mark them
// as run before; cases run before get no banner.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const csv = ["Title,Steps,Expected Result", `Open the store ${run},Open the store,Store shows`, `Search the store ${run},Search for shoes,Shoes shown`].join("\n");

async function importAndRun(page: Page, key: string, answer: RegExp) {
  await page.goto(`/p/${key}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "store.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("This file has no folders in it.")).toBeVisible();
  // No Folder column: only one new folder or no folder, and nothing to pick from.
  await expect(page.getByLabel("Use the file's folders")).toHaveCount(0);
  await expect(page.getByLabel("Folder for all cases")).toHaveCount(0);
  await page.getByLabel(/Don't use folders/).check();
  await expect(page.getByText("Answer “Have these cases been run before?”")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 2 cases" })).toBeDisabled();
  await page.getByLabel(answer).check();
  await page.getByRole("button", { name: "Import 2 cases" }).click();
  await expect(page.getByText("Imported 2 test cases")).toBeVisible();

  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Store");
  await expect(page.getByTestId("pick-hint")).toHaveText("Pick a folder, then tick the cases this suite runs.");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).toHaveURL(/\/suites\/(?!new$)\w+$/);
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

test("brand new imports get the New banner and can be marked as run before", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Fresh ${run}`, `FR${run}`);
  await importAndRun(page, `FR${run}`, /No, they're brand new/);

  const banner = page.getByTestId("news-heads-up");
  await expect(banner).toContainText("All 2 cases are new. Nobody has run them yet, so read each one carefully.");
  await expect(banner.getByRole("group", { name: "Show cases" })).toHaveCount(0);
  await banner.getByRole("button", { name: "Not new? Mark them as run before" }).click();
  await expect(banner).toContainText("Done. These 2 cases are marked as run before");
  await page.reload();
  await expect(page.getByTestId("news-heads-up")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: `Open the store ${run}` }).getByText("New", { exact: true })).toHaveCount(0);
});

test("imports run before get no New banner", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Old ${run}`, `OL${run}`);
  await importAndRun(page, `OL${run}`, /Yes, we've run them before/);
  await expect(page.getByRole("row").filter({ hasText: `Open the store ${run}` })).toBeVisible();
  await expect(page.getByTestId("news-heads-up")).toHaveCount(0);
});
