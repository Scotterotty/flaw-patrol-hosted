import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `S${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("run just the cases picked on the run page", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Selected ${KEY}`, KEY);
  for (const title of ["One", "Two", "Three", "Four"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All four");
  await page.getByRole("button", { name: /^Add all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Open the first case when it starts").uncheck();
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runUrl = page.url();

  // Search narrows the list by key or title.
  await page.getByLabel("Search cases in this run").fill("thr");
  await expect(page.getByText("1 match", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Three/ })).toBeVisible();
  // Picks survive searching: pick Three, search for Four and pick it with "select all shown", then clear.
  await page.getByLabel(`Select ${KEY}-3`).check();
  await page.getByLabel("Search cases in this run").fill("four");
  await expect(page.getByText("1 selected not shown")).toBeVisible();
  await page.getByLabel("Select all shown").check();
  await page.getByLabel("Search cases in this run").fill("");
  await expect(page.getByLabel(`Select ${KEY}-3`)).toBeChecked();
  await expect(page.getByLabel(`Select ${KEY}-4`)).toBeChecked();
  await expect(page.getByRole("link", { name: "Run 2 selected" })).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();

  // Nothing selected: no button. Pick Two and Four.
  await expect(page.getByRole("link", { name: /^Run \d+ selected$/ })).toHaveCount(0);
  await page.getByLabel(`Select ${KEY}-2`).check();
  await page.getByLabel(`Select ${KEY}-4`).check();
  await page.getByRole("link", { name: "Run 2 selected" }).click();

  await expect(page.getByRole("heading", { name: "Two" })).toBeVisible();
  await expect(page.getByText("Selected (2)")).toBeVisible();
  await expect(page.getByText("0 of 2 selected tested")).toBeVisible();
  const list = page.locator("aside ul").first();
  await expect(list.getByRole("link")).toHaveCount(2);

  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Passed" }).click();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("heading", { name: "Four" })).toBeVisible();
  await expect(page.getByText("Selected (2)")).toBeVisible();
  await page.getByRole("group", { name: "Step 1 status" }).getByRole("button", { name: "Failed" }).click();
  await page.getByRole("button", { name: "Save and finish" }).click();

  // Back on the run page: only the two picked cases have results.
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByText("2 of 4 cases")).toBeVisible();

  // Sort by status: untested first, then failed, then passed.
  await page.getByLabel("Sort cases").selectOption("status");
  await expect(page.locator("tbody tr td:nth-child(2) a")).toHaveText([/One/, /Three/, /Four/, /Two/]);
  await page.getByLabel("Sort cases").selectOption("order");
});
