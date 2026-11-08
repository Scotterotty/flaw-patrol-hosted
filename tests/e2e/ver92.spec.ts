import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn, openAccount } from "./auth";

// ver_92: Workspace settings for workspace admins. Microsoft (and other company)
// sign-in set from the page, invite emails through the company's mail server, and an
// activity log of admin and security events. mock-sso.mjs stands in for Microsoft and
// for the mail server.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `WA${TAG}`;
const SSO = `http://localhost:${process.env.MOCK_SSO_PORT ?? 3195}`;
const TENANT = "4f2a1c3e-0b7d-4e21-9a55-1d2f3c4b5a6e";
const newbie = `newbie-${TAG.toLowerCase()}@example.com`;
const invitee = `invitee-${TAG.toLowerCase()}@example.com`;

async function resetWorkspace(db: PrismaClient) {
  await db.signInProvider.deleteMany();
  await db.workspace.upsert({ where: { id: 1 }, create: { id: 1 }, update: { passwordSignIn: true, joinDomains: "", mailMode: "off", mailHost: "", mailUser: "", mailPassEncrypted: null, mailFromAddress: "" } });
}

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await resetWorkspace(db);
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.project.create({ data: { key: KEY, name: `Access ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await resetWorkspace(db);
  } finally {
    await db.$disconnect();
  }
});

const signInAs = (email: string, name = "Someone") => fetch(`${SSO}/__as?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`, { method: "POST" });
const mails = async () => (await (await fetch(`${SSO}/__mail`)).json()) as { to: string[]; subject: string; raw: string }[];
// Quoted-printable: join soft line breaks and decode =XX.
const decode = (raw: string) => raw.replace(/=\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

async function signOut(page: Page) {
  // Right after a sign-in redirect the menu may not be wired up yet, so retry opening it.
  await expect(async () => {
    await page.locator('header button[aria-haspopup="menu"]').click();
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible({ timeout: 2000 });
  }).toPass();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/signin/);
}

test("Workspace settings: only admins, Microsoft sign-in tested before it turns on", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Workspace settings" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  const tabs = page.getByRole("navigation", { name: "Workspace sections" });
  for (const t of ["Sign-in", "Email", "Activity log", "Game admin"]) await expect(tabs.getByRole("link", { name: t })).toBeVisible();
  // Game admin moved here from Your account.
  await openAccount(page);
  await expect(page.getByRole("navigation", { name: "Account sections" }).getByRole("link", { name: "Game admin" })).toHaveCount(0);

  // Testers don't get the page or the menu item.
  const ctx = await browser.newContext();
  const t = await ctx.newPage();
  await signIn(t, "tester@example.com", "Sam Tester");
  await t.locator('header button[aria-haspopup="menu"]').click();
  await expect(t.getByRole("menuitem", { name: "Workspace settings" })).toHaveCount(0);
  const res = await t.goto("/workspace");
  expect(res?.status()).toBe(404);
  await ctx.close();

  // Set up Microsoft.
  await page.goto("/workspace#sign-in");
  const card = page.getByRole("region", { name: "Sign-in" });
  const ms = card.getByRole("listitem").filter({ hasText: "Microsoft" });
  await expect(ms).toContainText("Not set up");
  await ms.getByRole("button", { name: "Set up" }).click();
  await expect(ms.getByLabel("Redirect URL")).toHaveValue("http://localhost:3100/api/auth/callback/microsoft");
  await ms.getByLabel(/Directory \(tenant\) ID/).fill("common");
  await ms.getByLabel(/Application \(client\) ID/).fill("client-123");
  await ms.getByLabel(/Client secret/).fill("s3cret-value");
  await ms.getByLabel("Also anyone with an email at").check();
  await ms.getByLabel("Email domains").fill("example.com");
  await ms.getByRole("button", { name: "Save" }).click();
  await expect(ms.getByText(/Enter the directory \(tenant\) ID/)).toBeVisible();
  await ms.getByLabel(/Directory \(tenant\) ID/).fill(TENANT);
  await ms.getByRole("button", { name: "Save" }).click();
  await expect(ms).toContainText("Saved · needs a test sign-in");

  // The secret is stored sealed, never in plain text.
  const db = new PrismaClient();
  const row = await db.signInProvider.findUniqueOrThrow({ where: { id: "microsoft" } });
  expect(row.secretEncrypted).toMatch(/^v1\./);
  expect(row.secretEncrypted).not.toContain("s3cret-value");

  // Not on yet: the sign-in page has no Microsoft button.
  const anon = await browser.newContext();
  const a = await anon.newPage();
  await a.goto("/signin");
  await expect(a.getByRole("button", { name: "Sign in with Microsoft" })).toHaveCount(0);

  await ms.getByRole("button", { name: "Check settings" }).click();
  await expect(ms.getByText("Microsoft answered. Now try Test sign-in.")).toBeVisible();
  await signInAs("admin@example.com", "Demo Admin");
  await ms.getByRole("button", { name: "Test sign-in" }).click();
  await expect(page).toHaveURL(/\/workspace\?tested=microsoft/);
  const ms2 = page.getByRole("region", { name: "Sign-in" }).getByRole("listitem").filter({ hasText: "Microsoft" });
  await expect(ms2.getByText("✓ Test sign-in worked as admin@example.com.")).toBeVisible();
  // The page just loaded from the sign-in redirect; retry the click until React is ready.
  await expect(async () => {
    await ms2.getByRole("button", { name: "Turn on" }).click();
    await expect(ms2).toContainText("On · also anyone at example.com", { timeout: 3000 });
  }).toPass();

  // Now the button shows, and an existing member signs in with Microsoft.
  await a.reload();
  await signInAs("tester@example.com", "Sam Tester");
  await a.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await expect(a).not.toHaveURL(/signin/);
  await expect(a.locator('header button[aria-haspopup="menu"]')).toContainText("Sam Tester");
  await signOut(a);

  // Someone at an allowed domain joins without being added first.
  await signInAs(newbie, "New Person");
  await a.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await expect(a).not.toHaveURL(/signin/);
  expect(await db.user.findUnique({ where: { email: newbie } })).not.toBeNull();
  await signOut(a);

  // Anyone else is turned away.
  await signInAs("outsider@other.example.org", "Outsider");
  await a.getByRole("button", { name: "Sign in with Microsoft" }).click();
  await expect(a.getByText("That account hasn't been invited yet.")).toBeVisible();

  // Email and password off: only the buttons, plus Admin sign-in.
  const pw = page.getByRole("region", { name: "Sign-in" }).getByRole("listitem").filter({ hasText: "Email and password" });
  await pw.getByRole("switch", { name: "Email and password sign-in" }).click();
  await expect(pw).toContainText("Off for everyone except workspace admins");
  await a.goto("/signin");
  await expect(a.getByLabel("Email")).toHaveCount(0);
  await a.getByRole("link", { name: "Admin sign-in" }).click();
  await a.getByLabel("Email").fill("tester@example.com");
  await a.getByRole("button", { name: "Continue" }).click();
  await expect(a.getByText("Email and password sign-in is off. Use one of the sign-in buttons instead.")).toBeVisible();
  await pw.getByRole("switch", { name: "Email and password sign-in" }).click();
  await expect(pw).toContainText("On");
  await anon.close();
  await db.$disconnect();
});

test("Invite emails go through the company's mail server", async ({ page, browser }) => {
  await fetch(`${SSO}/__mail`, { method: "DELETE" });
  await signIn(page, "admin@example.com", "Demo Admin");

  // Without email, Add still gives the message to copy.
  await page.goto(`/p/${KEY}/settings`);
  await expect(page.getByLabel("Email them an invite")).toHaveCount(0);

  await page.goto("/workspace#email");
  const email = page.getByRole("region", { name: "Email" });
  await email.getByLabel("Send email through").selectOption("smtp");
  await email.getByLabel("Mail server", { exact: true }).fill("localhost");
  await email.getByLabel("Port", { exact: true }).fill("3194");
  await email.getByLabel("Security", { exact: true }).selectOption("none");
  await email.getByLabel("From address", { exact: true }).fill("qa-notify@example.com");
  await email.getByRole("button", { name: "Send test email to me" }).click();
  await expect(email.getByText("✓ Sent to admin@example.com")).toBeVisible();
  expect((await mails()).some((m) => m.subject === "Flaw Patrol test email" && m.to.includes("admin@example.com"))).toBe(true);
  await email.getByRole("button", { name: "Save" }).click();
  await expect(email.getByText("Saved")).toBeVisible();

  // Add someone: they get an invite email with a one-time link.
  await page.goto(`/p/${KEY}/settings`);
  await expect(page.getByLabel("Email them an invite")).toBeChecked();
  await page.getByLabel("Add people by email").fill(invitee);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Invite sent to ${invitee}`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: invitee })).toContainText("invited · email sent");
  const invite = (await mails()).find((m) => m.to.includes(invitee));
  expect(invite?.subject).toBe("Demo Admin invited you to Flaw Patrol");
  const text = decode(invite!.raw);
  expect(text).toContain(`Demo Admin added you to Access ${TAG} as a Member.`);
  const url = /Accept invite: (http\S+\/invite\/\S+)/.exec(text)?.[1];
  expect(url).toBeTruthy();

  // Copy invite link and Resend are offered until they sign in.
  const row = page.getByRole("listitem").filter({ hasText: invitee });
  await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy invite link" })).toBeVisible();

  // The invite page: choose a password, then sign in.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url!);
  // Since ver_137 it names who invited them and where, asks their name and signs them in.
  await expect(p.getByRole("heading", { name: /^Demo Admin invited you to / })).toBeVisible();
  await p.getByLabel("Your name").fill("Invited Person");
  await p.getByLabel("Choose a password").fill("invited person pw 1");
  await p.getByLabel("Confirm password").fill("invited person pw 1");
  await p.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(p).not.toHaveURL(/signin|invite/);
  // The link works once.
  await p.goto(url!);
  await expect(p.getByRole("heading", { name: "This invite doesn't work anymore" })).toBeVisible();
  await ctx.close();
});

test("Activity log: admin and security events, never results or bugs", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  // A wrong password is logged as a failed sign-in.
  const db = new PrismaClient();
  await page.goto(`/workspace?days=1#activity`);
  const log = page.getByRole("region", { name: "Activity log" });
  await expect(log.getByRole("row").filter({ hasText: "Turned on Microsoft sign-in" }).first()).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: `Added ${invitee} as Member` })).toContainText("Invite emailed");
  await expect(log.getByRole("row").filter({ hasText: "Signed in with Microsoft" }).first()).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "Accepted an invite and chose a password" }).first()).toBeVisible();

  await log.getByLabel("What").selectOption("settings");
  await expect(page).toHaveURL(/kind=settings/);
  await expect(log.getByRole("row").filter({ hasText: "Signed in with Microsoft" })).toHaveCount(0);
  await expect(log.getByRole("row").filter({ hasText: "Set up email" }).first()).toBeVisible();

  const csv = await page.request.get(`/workspace/activity/export?days=1&kind=settings`);
  expect(csv.status()).toBe(200);
  const body = await csv.text();
  expect(body.split("\n")[0]).toContain("When (UTC),Who,Type,What,Where,Details,IP address");
  expect(body).toContain("Turned on Microsoft sign-in");
  // Secrets never reach the log.
  expect(body).not.toContain("s3cret-value");

  // Nothing about results, cases run or bugs filed is ever written. Bringing a whole run in (automation
  // or a spreadsheet, ver_166) is a run event, like making a run.
  const kinds = await db.activityEntry.groupBy({ by: ["kind"], _count: true });
  for (const k of kinds) expect(["signin", "people", "settings", "delete", "run"]).toContain(k.kind);
  expect(await db.activityEntry.count({ where: { action: { contains: "result", mode: "insensitive" }, NOT: { OR: [{ action: { contains: "automation results" } }, { action: { contains: "results from a spreadsheet" } }] } } })).toBe(0);
  await db.$disconnect();
});

test("Company SSO: any OpenID Connect service, unverified emails turned away", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/workspace#sign-in");
  const row = page.getByRole("region", { name: "Sign-in" }).getByRole("listitem").filter({ hasText: "Company SSO" });
  await row.getByRole("button", { name: "Set up" }).click();
  await row.getByLabel("Issuer URL", { exact: true }).fill(`${SSO}/oidc`);
  await row.getByLabel("Button name", { exact: true }).fill("Okta");
  await row.getByLabel("Client ID", { exact: true }).fill("fp-client");
  await row.getByLabel("Client secret", { exact: true }).fill("another-secret");
  await expect(row.getByLabel("Redirect URL")).toHaveValue("http://localhost:3100/api/auth/callback/oidc");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Saved · needs a test sign-in");
  await signInAs("admin@example.com", "Demo Admin");
  await row.getByRole("button", { name: "Test sign-in" }).click();
  await expect(page).toHaveURL(/tested=oidc/);
  const okta = page.getByRole("region", { name: "Sign-in" }).getByRole("listitem").filter({ hasText: "Company SSO" });
  await expect(async () => {
    await okta.getByRole("button", { name: "Turn on" }).click();
    await expect(okta).toContainText("On", { timeout: 3000 });
  }).toPass();

  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await a.goto("/signin");
  await fetch(`${SSO}/__as?email=tester%40example.com&name=Sam&verified=false`, { method: "POST" });
  await a.getByRole("button", { name: "Sign in with Okta" }).click();
  await expect(a.getByText("That account's email address isn't verified")).toBeVisible();
  await signInAs("tester@example.com", "Sam Tester");
  await a.getByRole("button", { name: "Sign in with Okta" }).click();
  await expect(a).not.toHaveURL(/signin/);
  await ctx.close();
});
