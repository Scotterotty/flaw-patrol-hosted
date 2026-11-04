import { expect, test, type Page } from "@playwright/test";
import { backToRun, signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_96: a [WEB] title word becomes a tag, cases new or edited since their last run are
// tagged New and Updated, and a bug found in an earlier run shows up as a known bug.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `NW${run}`;

let suiteUrl = "";

async function startRun(page: Page) {
  await page.goto(suiteUrl);
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

test("bracket tags, New and Updated cases, and known bugs from earlier runs", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `News ${run}`, KEY);

  // [WEB] at the start of a title becomes a tag; the title keeps the rest.
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("[WEB] - Login - Remember me");
  await page.getByLabel("Step 1 action").fill("Tick Remember me and sign in");
  await page.getByLabel("Step 1 expected result").fill("Signed in");
  await page.getByRole("button", { name: "+ Add step" }).click();
  await page.getByLabel("Step 2 action").fill("Close and reopen the browser");
  await page.getByLabel("Step 2 expected result").fill("Still signed in");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Login - Remember me", level: 1 })).toBeVisible();
  await expect(page.getByText("WEB", { exact: true }).first()).toBeVisible();
  // Searching finds it by its tag, in any case.
  await page.goto(`/p/${KEY}/cases?q=web`);
  await expect(page.getByRole("link", { name: /Login - Remember me/ })).toBeVisible();

  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Login");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).toHaveURL(/\/suites\/(?!new$)\w+$/);
  suiteUrl = page.url();

  // First run: the case has never been run, so it's New.
  await startRun(page);
  const row = page.getByRole("row").filter({ hasText: "Login - Remember me" });
  await expect(row.getByText("New", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "Test" }).click();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByLabel("Step 2 actual result").fill("Signed out after reopening");
  await page.getByRole("button", { name: "Report bug", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Save bug" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Save and finish" }).click();
  await backToRun(page);

  // Edit the case: the next run marks it Updated, with what changed.
  await page.goto(`/p/${KEY}/cases/1/edit`);
  await page.getByLabel("Step 2 expected result").fill("Still signed in after 30 days");
  await page.getByRole("button", { name: "Save new version" }).first().click();
  await expect(page.getByRole("heading", { name: "Login - Remember me", level: 1 })).toBeVisible();

  await startRun(page);
  const row2 = page.getByRole("row").filter({ hasText: "Login - Remember me" });
  await expect(row2.getByText("Updated", { exact: true })).toBeVisible();
  await expect(row2.getByText("New", { exact: true })).toHaveCount(0);

  // The bug from the first run is a known bug here, to check while testing.
  await row2.getByRole("link", { name: "Test" }).click();
  const known = page.getByRole("region", { name: "Known bugs" });
  await expect(known).toContainText("1 known bug on this case");
  if ((await known.getByRole("button").first().getAttribute("aria-expanded")) === "false") await known.getByRole("button").first().click();
  await known.getByRole("button", { name: "Still happens" }).click();
  await expect(known.getByText("✓ Still happens")).toBeVisible();
  await expect(page.getByRole("group", { name: "Step 2 status" }).getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");
});
