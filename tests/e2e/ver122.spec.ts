import { expect, test } from "@playwright/test";
import pkg from "../../package.json";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const run = Date.now().toString(36).slice(-4).toUpperCase();

// ver_122: the version number shows under Arrange menu order and at the bottom of the name menu;
// clicking it copies it.

test("the version shows under Arrange menu order and in the name menu, and copies on click", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Version ${run}`, `VN${run}`);
  await page.goto(`/p/VN${run}`);
  const nav = page.locator("nav").filter({ hasText: "Arrange menu order" }).first();
  const line = nav.getByTestId("version-line");
  await expect(line).toHaveText(`Version ${pkg.version}`);
  await line.click();
  await expect(line).toHaveText(`Copied ${pkg.version}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(pkg.version);
  await expect(line).toHaveText(`Version ${pkg.version}`, { timeout: 5_000 });

  // The name menu: last line under Sign out, stays open after copying.
  await page.locator('header button[aria-haspopup="menu"]').click();
  const menu = page.getByRole("menu");
  const menuLine = menu.getByTestId("version-line");
  await expect(menuLine).toHaveText(`Version ${pkg.version}`);
  await menuLine.click();
  await expect(menuLine).toHaveText(`Copied ${pkg.version}`);
  await expect(menu).toBeVisible();
});
