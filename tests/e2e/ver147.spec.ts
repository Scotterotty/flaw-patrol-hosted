import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_147: steps inside a shared step block get a thin line above each one, like other steps,
// on the case page and in the case editor's shared step preview. Uses the seeded SHOP case 1,
// which starts with the shared step "Log in as {{role}}" (two steps, 1.1 and 1.2).

test("shared steps have a line above each step", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");

  await page.goto("/p/SHOP/cases/1");
  const table = page.locator("[data-steps-table]");
  await expect(table).toBeVisible();
  for (const n of ["1.1", "1.2"]) {
    const row = table.locator("tr").filter({ has: page.locator("td", { hasText: new RegExp(`^${n.replace(".", "\\.")}$`) }) });
    await expect(row).toHaveCount(1);
    await expect(row).toHaveCSS("border-top-width", "1px");
    await expect(row).toHaveCSS("border-top-style", "solid");
  }

  // Editor: the shared step preview has a line between its steps.
  await page.goto("/p/SHOP/cases/1/edit");
  const preview = page
    .locator("ol")
    .filter({ hasText: "Open /login" })
    .filter({ hasText: "Login form is shown" })
    .filter({ hasNot: page.locator("ol") })
    .first();
  await expect(preview).toBeVisible();
  const items = preview.locator("> li");
  await expect(items).toHaveCount(2);
  // Tailwind 4 divide-y draws the line under every item but the last.
  await expect(items.nth(0)).toHaveCSS("border-bottom-width", "1px");
  await expect(items.nth(1)).toHaveCSS("border-bottom-width", "0px");
});
