import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `N${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("a suite can be renamed from its page and the suites list, and old runs show the old name", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Rename suite ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Pay with card");
  await page.getByLabel("Step 1 action").fill("Pay");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Pay with card" })).toBeVisible();
  for (const name of ["Smoke test", "Checkout regression"]) {
    await page.goto(`/p/${KEY}/suites/new`);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: /^Tick all/ }).click();
    await page.getByRole("button", { name: "Create suite" }).click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  }

  // Run it once under the old name.
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Run name").fill("Before rename");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  const runUrl = page.url();
  await expect(page.getByTestId("suite-then-called")).toHaveCount(0);
  await page.getByRole("link", { name: /Checkout regression v1/ }).click();

  // Edit cases is still there; Rename sits by the name.
  await expect(page.getByRole("link", { name: "Edit cases" })).toBeVisible();
  await page.getByRole("button", { name: "Rename suite" }).click();
  const box = page.getByRole("dialog", { name: "Rename suite" });
  await expect(box.getByLabel("Name")).toHaveValue("Checkout regression");
  await box.getByLabel("Name").fill("smoke test");
  await expect(box.getByTestId("rename-twin")).toContainText("Another suite is already called smoke test");
  await box.getByLabel("Name").fill("");
  await expect(box.getByRole("button", { name: "Save name" })).toBeDisabled();
  await box.getByLabel("Name").fill("Checkout and payment regression");
  await box.getByLabel("Name").press("Enter");
  await expect(page.getByRole("heading", { name: "Checkout and payment regression", level: 1 })).toBeVisible();
  await expect(page.getByText("Version 2 · 1 case")).toBeVisible();

  // The old run names both.
  await page.goto(runUrl);
  await expect(page.getByTestId("suite-then-called")).toHaveText(" (then called Checkout regression)");
  await expect(page.getByRole("link", { name: /Checkout and payment regression v1/ })).toBeVisible();

  // Rename from the More menu, then from the list row's ⋯.
  await page.getByRole("link", { name: /Checkout and payment regression v1/ }).click();
  await expect(page.getByRole("heading", { name: "Checkout and payment regression", level: 1 })).toBeVisible();
  // Retry the click in case it lands before the page is ready.
  await expect(async () => {
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename suite…" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("menuitem", { name: "Rename suite…" }).click();
  await page.getByRole("dialog", { name: "Rename suite" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Rename suite" })).toBeHidden();

  await page.goto(`/p/${KEY}/suites`);
  await expect(async () => {
    await page.getByRole("button", { name: "Actions for Smoke test" }).click();
    await expect(page.getByRole("menuitem", { name: "Rename suite…" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("menuitem", { name: "Rename suite…" }).click();
  const rowBox = page.getByRole("dialog", { name: "Rename suite" });
  await rowBox.getByLabel("Name").fill("Smoke check");
  await rowBox.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("link", { name: /Smoke check/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Smoke test/ })).toHaveCount(0);

  // The rename is in the activity log.
  await page.goto(`/workspace?days=1&q=${encodeURIComponent("Smoke check")}#activity`);
  const log = page.getByRole("region", { name: "Activity log" });
  await expect(log.getByRole("row").filter({ hasText: `Renamed suite "Smoke test" to "Smoke check"` })).toBeVisible();
});
