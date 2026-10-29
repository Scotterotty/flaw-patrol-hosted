import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `P${run}`;
const member = `pw-${run.toLowerCase()}@example.com`;

async function signOut(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/signin/);
}

async function tryPassword(page: Page, email: string, password: string) {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("passwords: first-time setup, wrong password, admin link, change", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Passwords ${run}`, KEY);
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Add someone by email").fill(member);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(member, { exact: true })).toBeVisible();

  // The invited member chooses a password the first time.
  const other = await browser.newContext();
  const m = await other.newPage();
  await m.goto("/signin");
  await m.getByLabel("Email").fill(member);
  await m.getByRole("button", { name: "Continue" }).click();
  await expect(m.getByText("You don't have a password yet")).toBeVisible();
  await m.getByLabel("Your name").fill("Pat Member");
  await m.getByLabel("New password").fill("first password 1");
  await m.getByLabel("Confirm password").fill("first password 2");
  await m.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(m.getByText("The two passwords don't match.")).toBeVisible();
  await m.getByLabel("Confirm password").fill("first password 1");
  await m.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(m).not.toHaveURL(/signin/);
  await expect(m.locator('header button[aria-haspopup="menu"]')).toContainText("Pat Member");
  await signOut(m);

  // Wrong password is refused, the right one works.
  await tryPassword(m, member, "not my password");
  await expect(m.getByText("That email and password don't match.")).toBeVisible();
  await tryPassword(m, member, "first password 1");
  await expect(m).not.toHaveURL(/signin/);
  await signOut(m);

  // Forgotten password: the admin makes a one-time link.
  await page.reload();
  await page.getByRole("listitem").filter({ hasText: member }).getByRole("button", { name: "Password link" }).click();
  const url = await page.getByLabel("Password link").inputValue();
  expect(url).toMatch(/\/reset\//);
  await m.goto(url);
  await m.getByLabel("New password").fill("second password");
  await m.getByLabel("Confirm password").fill("second password");
  await m.getByRole("button", { name: "Set password" }).click();
  await expect(m).toHaveURL(/signin\?email=/);
  await expect(m.getByLabel("Email")).toHaveValue(member);
  await m.goto(url);
  await expect(m.getByText("This link doesn't work anymore")).toBeVisible();
  await tryPassword(m, member, "first password 1");
  await expect(m.getByText("That email and password don't match.")).toBeVisible();
  await tryPassword(m, member, "second password");
  await expect(m).not.toHaveURL(/signin/);

  // Change it from Your account.
  await m.goto("/account");
  await m.getByLabel("Current password").fill("second password");
  await m.getByLabel("New password", { exact: true }).fill("third password");
  await m.getByLabel("Confirm new password").fill("third password");
  await m.getByRole("button", { name: "Change password" }).click();
  await expect(m.getByText("Password saved")).toBeVisible();
  await signOut(m);
  await tryPassword(m, member, "third password");
  await expect(m).not.toHaveURL(/signin/);
  await other.close();
});
