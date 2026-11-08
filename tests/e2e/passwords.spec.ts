import { expect, test, type Page } from "@playwright/test";
import { signIn, openAccount } from "./auth";
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
  await page.getByLabel("Add people by email").fill(member);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(member, { exact: true })).toBeVisible();

  // An invited member can't choose a first password on the sign-in page (ver_103):
  // that would let anyone who knows the email take the account.
  const other = await browser.newContext();
  const m = await other.newPage();
  await m.goto("/signin");
  await m.getByLabel("Email").fill(member);
  await m.getByRole("button", { name: "Continue" }).click();
  await expect(m.getByText("You don't have a password yet. Use the invite link in your email")).toBeVisible();
  await expect(m.getByLabel("New password")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: member })).toContainText("invited, hasn't signed in yet");

  // They choose it from the invite link instead.
  await page.getByRole("listitem").filter({ hasText: member }).getByRole("button", { name: "Copy invite link" }).click();
  const invite = /(http\S+\/invite\/\S+)/.exec(await page.getByLabel("Invite link").inputValue())?.[1];
  expect(invite).toBeTruthy();
  await m.goto(invite!);
  await m.getByLabel("Your name").fill("Pat Member");
  await m.getByLabel("Choose a password").fill("first password 1");
  await m.getByLabel("Confirm password").fill("first password 2");
  await m.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(m.getByText("The two passwords don't match.")).toBeVisible();
  await m.getByLabel("Confirm password").fill("first password 1");
  // Since ver_137 the invite signs them straight in.
  await m.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(m).not.toHaveURL(/signin|invite/);
  await expect(m.locator('header button[aria-haspopup="menu"]')).toBeVisible();
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
  await openAccount(m);
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
