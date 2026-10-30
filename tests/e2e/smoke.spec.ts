import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// The preflight's quick check (scripts/e2e-preflight.mjs): if signing in and opening a page fails,
// nothing else will pass, so the full run never starts.
test("sign in and open the umbrellas page", async ({ page }) => {
  await page.goto("/signin");
  // Sign-in must come back to the test server, not the 3000 one a .env may name (ver_96's first run).
  await signIn(page, "admin@example.com", "Demo Admin").catch(() => {});
  expect(new URL(page.url()).origin, "Sign-in sent the browser away from the test server. Check AUTH_URL, and that no old server is on port 3100.").toBe("http://localhost:3100");
  await expect(page).not.toHaveURL(/signin/);
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Web storefront/ }).first()).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("button", { name: /Open all|Close all/ }).first()).toBeVisible();
});
