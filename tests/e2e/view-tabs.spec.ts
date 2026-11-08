import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `V${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("Active and Closed tabs on Test runs, Active and Archived tabs on Test cases", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `View tabs ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  for (const title of ["Alpha", "Bravo"]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }

  // Archive Bravo (we are on its page): it moves to the Archived tab.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Archive case" }).click();
  await expect(page.getByText("Archived", { exact: true })).toBeVisible();
  await page.goto(`/p/${KEY}/cases`);
  const caseTabs = page.getByRole("navigation", { name: "Case state" });
  await expect(caseTabs.getByRole("link", { name: "Active 1" })).toHaveAttribute("aria-current", "page");
  await caseTabs.getByRole("link", { name: "Archived 1" }).click();
  await expect(caseTabs.getByRole("link", { name: "Archived 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Bravo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alpha" })).toHaveCount(0);
  await expect(page.getByText("Show archived")).toHaveCount(0);

  // Create a run of Alpha, then close it.
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("One");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runUrl = page.url();

  await page.goto(`/p/${KEY}/runs`);
  const runTabs = page.getByRole("navigation", { name: "Run state" });
  await expect(runTabs.getByRole("link", { name: "Active 1" })).toHaveAttribute("aria-current", "page");
  await expect(runTabs.getByRole("link", { name: "Closed 0" })).toBeVisible();
  await expect(page.getByText("Show closed runs")).toHaveCount(0);

  await page.goto(runUrl);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Close run" }).click();
  // Untested cases: it asks first (ver_137).
  await page.getByTestId("close-run-ask").getByRole("button", { name: "Close anyway" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();

  await page.goto(`/p/${KEY}/runs`);
  await expect(runTabs.getByRole("link", { name: "Active 0" })).toBeVisible();
  await expect(page.getByText("No active runs")).toBeVisible();
  await runTabs.getByRole("link", { name: "Closed 1" }).click();
  await expect(runTabs.getByRole("link", { name: "Closed 1" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Test runs" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^One/ })).toBeVisible();
  // The run buttons stay put on the Closed tab.
  await expect(page.getByRole("button", { name: "Import results" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create a run" })).toBeVisible();
});
