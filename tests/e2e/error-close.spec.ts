import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
test("errors can be closed", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account");
  const pw = page.getByLabel("Current password");
  if (await pw.count()) {
    await pw.fill("wrong wrong wrong");
    await page.getByLabel("New password", { exact: true }).fill("another long password");
    await page.getByLabel("Confirm new password").fill("another long password");
    await page.getByRole("button", { name: /Change password/ }).click();
  }
  const alert = page.locator("p[role=alert]");
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Close message" }).click();
  await expect(page.locator("p[role=alert]")).toHaveCount(0);
});
