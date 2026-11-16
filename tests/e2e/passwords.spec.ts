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
  await expect(m.getByLabel(/New password|Choose a password/)).toHaveCount(0);
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
  // Changing your own password keeps this browser signed in (hosted build: other browsers are signed out).
  await m.reload();
  await expect(m).not.toHaveURL(/signin/);
  await signOut(m);
  await tryPassword(m, member, "third password");
  await expect(m).not.toHaveURL(/signin/);
  await other.close();
});

// Hosted build (backend team review C1): a test cycle admin who isn't a workspace admin can't
// see a colleague's password link (it would let them sign in as that colleague). With email
// off, they're told to ask a workspace admin; an invite link can't be made for someone who joined.
test("password links: only workspace admins see them", async ({ page }) => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const owner = `owner-${run.toLowerCase()}@example.com`;
  const colleague = `colleague-${run.toLowerCase()}@example.com`;
  try {
    await db.workspace.upsert({ where: { id: 1 }, create: { id: 1, mailMode: "off" }, update: { mailMode: "off" } });
    const o = await db.user.upsert({ where: { email: owner }, create: { email: owner, name: `Owner ${run}` }, update: {} });
    const c = await db.user.upsert({ where: { email: colleague }, create: { email: colleague, name: `Colleague ${run}`, lastLoginAt: new Date() }, update: {} });
    await db.project.create({ data: { key: `PO${run}`, name: `Owned ${run}`, members: { create: [{ userId: o.id, role: "ADMIN" }, { userId: c.id, role: "TESTER" }] } } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, owner, `Owner ${run}`);
  await page.goto(`/p/PO${run}/settings`);
  const row = page.getByRole("listitem").filter({ hasText: colleague });
  await row.getByRole("button", { name: "Password link" }).click();
  await expect(page.getByText("Password links go to the person's own email, and email isn't set up. Ask a workspace admin to make one.")).toBeVisible();
  await expect(page.getByLabel("Password link")).toHaveCount(0);
});

// Hosted build (backend team review: "Sessions aren't revoked"): a password set after you signed
// in, somewhere else, signs this browser out.
test("a new password signs out other browsers", async ({ page }) => {
  const { PrismaClient } = await import("@prisma/client");
  const email = `revoke-${run.toLowerCase()}@example.com`;
  const db = new PrismaClient();
  try {
    await db.user.upsert({ where: { email }, create: { email, name: `Revoke ${run}` }, update: {} });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, email, `Revoke ${run}`);
  await page.goto("/account");
  await expect(page).not.toHaveURL(/signin/);
  const db2 = new PrismaClient();
  try {
    await db2.user.update({ where: { email }, data: { passwordSetAt: new Date(Date.now() + 1000) } });
  } finally {
    await db2.$disconnect();
  }
  // A brand-new password waits out a 10-second grace (PASSWORD_GRACE_MS in auth.ts) before it counts.
  await page.waitForTimeout(12_000);
  await page.goto("/account");
  await expect(page).toHaveURL(/signin/);
});
