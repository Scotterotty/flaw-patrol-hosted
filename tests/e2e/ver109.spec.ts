import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `B${Date.now().toString(36).slice(-4).toUpperCase()}`;

// The step result buttons sit under the Expected text, on every screen width.
async function buttonsUnderExpected(page: Page) {
  const group = page.getByRole("group", { name: "Step 1 status" });
  const expected = page.getByText("The holdout cuts out what is behind it");
  await expect(group).toBeVisible();
  const g = (await group.boundingBox())!;
  const e = (await expected.boundingBox())!;
  expect(g.y).toBeGreaterThan(e.y + e.height - 1);
  expect(Math.abs(g.x - e.x)).toBeLessThan(2);
}

test("step result buttons sit under Expected", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Buttons ${KEY}`, KEY);
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("AR mode");
  await page.getByLabel("Step 1 action").fill("Look at the holdout object in AR mode");
  await page.getByLabel("Step 1 expected result").fill("The holdout cuts out what is behind it");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "AR mode" })).toBeVisible();
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("AR");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  await page.getByRole("row").filter({ hasText: "AR mode" }).getByRole("link", { name: "Test" }).click();
  await expect(page.getByRole("heading", { name: "AR mode" })).toBeVisible();

  for (const width of [1920, 1280, 400]) {
    await page.setViewportSize({ width, height: 900 });
    await buttonsUnderExpected(page);
  }

  // The buttons still work and Clear shows next to them.
  await page.setViewportSize({ width: 1280, height: 900 });
  const group = page.getByRole("group", { name: "Step 1 status" });
  await group.getByRole("button", { name: "Passed" }).click();
  await expect(group.getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: "Clear step 1" }).click();
  await expect(group.getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "false");
});
