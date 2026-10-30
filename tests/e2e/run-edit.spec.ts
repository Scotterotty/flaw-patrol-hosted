import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `E${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("a run's details can be edited after it starts", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Edit run ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Only case");
  await page.getByLabel("Step 1 action").fill("Do it");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Only case" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Start test run" }).click();
  await page.getByLabel("Run name").fill("Typo run");
  await page.getByLabel("Release", { exact: true }).fill("2.4.0-rc1");
  await page.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByText(/Release 2\.4\.0-rc1/)).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Edit details" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit run details" });
  await expect(dialog.getByLabel("Run name")).toHaveValue("Typo run");
  await dialog.getByLabel("Run name").fill("Smoke for RC2");
  await dialog.getByLabel("Release", { exact: true }).fill("2.4.0-rc2");
  await dialog.getByLabel("Build").fill("#1490");
  await dialog.getByLabel("CSP version").fill("3.8.1");
  await dialog.getByLabel("Environment").fill("Staging");
  await dialog.getByLabel("Notes").fill("Rerun after the hotfix");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: /Smoke for RC2/ })).toBeVisible();
  await expect(page.getByText(/Release 2\.4\.0-rc2 · .*Build #1490 · CSP 3\.8\.1 · Staging/)).toBeVisible();
  await expect(page.getByText("Rerun after the hotfix")).toBeVisible();
});
