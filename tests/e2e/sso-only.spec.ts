import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

// Hosted build (backend team review item 7): company sign-in only. Needs a server started with
// E2E_SSO_ONLY=1 (playwright.config.ts then sets AUTH_SSO_ONLY, AUTH_ADMIN_EMAILS and Microsoft
// sign-in from the server's settings, pointed at mock-sso.mjs). Skipped in the normal runs.
test.skip(!process.env.E2E_SSO_ONLY, "needs a server started with E2E_SSO_ONLY=1");

const SSO = `http://localhost:${process.env.MOCK_SSO_PORT ?? 3195}`;
const TAG = Date.now().toString(36).slice(-4);
export const SSO_ADMIN = "boss-sso@example.com";
const signInAs = (email: string, name: string) => fetch(`${SSO}/__as?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`, { method: "POST" });

test("company sign-in only: no passwords anywhere, admins named by the server", async ({ page }) => {
  // The sign-in page: only the Microsoft button, also with ?admin=1.
  for (const path of ["/signin", "/signin?admin=1"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Sign in with Microsoft" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Admin sign-in" })).toHaveCount(0);
  }
  // The server has no email-and-password sign-in at all.
  const providers = (await (await page.request.get("/api/auth/providers")).json()) as Record<string, unknown>;
  expect(Object.keys(providers)).toEqual(["microsoft"]);

  // The admin named in AUTH_ADMIN_EMAILS signs in with Microsoft and is a workspace admin.
  await signInAs(SSO_ADMIN, `Boss ${TAG}`);
  await page.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await expect(page).not.toHaveURL(/signin/);
  const db = new PrismaClient();
  try {
    expect((await db.user.findUniqueOrThrow({ where: { email: SSO_ADMIN } })).isAdmin).toBe(true);
    // Someone who isn't named stays a member.
    expect((await db.user.findUnique({ where: { email: "tester@example.com" } }))?.isAdmin ?? false).toBe(false);
  } finally {
    await db.$disconnect();
  }

  // Workspace settings says why, with no switch.
  await page.goto("/workspace#sign-in");
  const pw = page.getByRole("region", { name: "Sign-in", exact: true }).getByRole("listitem").filter({ hasText: "Email and password" });
  await expect(pw).toContainText("Off for everyone, admins too. Your server is set to company sign-in only.");
  await expect(pw.getByRole("switch")).toHaveCount(0);

  // No Password card on Your account.
  await page.goto("/account");
  await expect(page.locator("#password")).toHaveCount(0);

  // No password or invite links on a team's members list.
  await page.goto("/p/SHOP/settings");
  await expect(page.getByRole("button", { name: "Password link" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy invite link" })).toHaveCount(0);

  // A password link from before doesn't work.
  await page.goto("/reset/not-a-real-token");
  await expect(page.getByText("This link doesn't work anymore")).toBeVisible();
});
