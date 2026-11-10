import { expect, test } from "@playwright/test";
import { openMoreDetails } from "./case-form";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `S${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("suites, runs and the runner can list cases by priority", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Sort ${KEY}`, KEY);
  for (const [title, priority] of [["Lowly", "LOW"], ["Urgent", "CRITICAL"], ["Middling", "MEDIUM"]]) {
    await page.goto(`/p/${KEY}/cases/new`);
    await page.getByLabel("Title").fill(title);
    await openMoreDetails(page);
    await page.getByLabel("Priority").selectOption(priority);
    await page.getByLabel("Step 1 action").fill("Do it");
    await page.getByRole("button", { name: "Create case" }).first().click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Mixed");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("button", { name: "Create a run" })).toBeVisible();

  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  const before = await rows.allTextContents();
  expect(before.findIndex((t) => t.includes("Lowly"))).toBeLessThan(before.findIndex((t) => t.includes("Urgent")));

  await page.getByLabel("Sort cases").selectOption("priority");
  await expect(rows.first()).toContainText("Urgent");
  await expect(rows.last()).toContainText("Lowly");

  // The choice sticks for the run and the runner, and the runner starts on the most urgent case.
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByLabel("Sort cases")).toHaveValue("priority");
  await expect(page.locator("tbody tr").first()).toContainText("Urgent");
  await page.getByRole("link", { name: "Start testing" }).click();
  await expect(page.getByRole("heading", { name: "Urgent" })).toBeVisible();
  const sidebar = page.locator("aside ul").first();
  await expect(sidebar.locator("li").first()).toContainText("Urgent");
  await expect(sidebar.locator("li").first()).toContainText("Critical");

  await page.getByLabel("Sort cases").selectOption("order");
  await expect(page.getByLabel("Sort cases")).toHaveValue("order");
  await expect(sidebar.locator("li").first()).not.toContainText("Urgent");
});
