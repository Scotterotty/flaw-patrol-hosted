import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { hashPassword } from "../../src/lib/password";

export const PASSWORD = "flaw patrol e2e password";

const handled = new WeakSet<Page>();

/**
 * Someone added in a test has no password, and since ver_103 the sign-in page won't
 * let them choose one (that takes an invite or password link). Set it straight in
 * the database instead, the way the link would.
 */
async function givePassword(email: string, name: string, password: string) {
  const db = new PrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, name: true } });
    if (!user) return false;
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), passwordSetAt: new Date(), name: user.name ?? (name || null) } });
    return true;
  } finally {
    await db.$disconnect();
  }
}

/** Sign in, setting the password first if this account doesn't have one yet. */
export async function signIn(page: Page, email: string, name = "", password = PASSWORD) {
  // The What's new window opens once per version after sign-in (ver_88); close it whenever it shows up.
  if (!handled.has(page)) {
    handled.add(page);
    await page.addLocatorHandler(page.getByTestId("whats-new-window"), async (w) => {
      await w.getByRole("button", { name: "Close", exact: true }).click();
    });
  }
  const create = page.getByLabel("Confirm password");
  const existing = page.getByLabel("Password", { exact: true });
  const noPassword = page.getByText("You don't have a password yet. Use the invite link");
  for (let i = 0; i < 2; i++) {
    await page.goto("/signin");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(create.or(existing).or(noPassword)).toBeVisible();
    if (!(await noPassword.isVisible())) break;
    expect(await givePassword(email, name, password)).toBe(true);
  }
  if (await create.isVisible()) {
    if (name) await page.getByLabel("Your name").fill(name);
    await page.getByLabel("New password").fill(password);
    await create.fill(password);
    await page.getByRole("button", { name: "Set password and sign in" }).click();
  } else {
    await existing.fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page).not.toHaveURL(/signin/);
}

/** After saving a run's last case the runner offers to close the run (ver_70); otherwise it goes back to the run page. Either way, end up on the run page. */
export async function backToRun(page: Page) {
  const prompt = page.getByText(/That was the last case in R\d+/);
  await expect(async () => {
    expect(/\/runs\/\d+$/.test(new URL(page.url()).pathname) || (await prompt.isVisible())).toBe(true);
  }).toPass();
  if (!/\/runs\/\d+$/.test(new URL(page.url()).pathname)) await page.goto(page.url().replace(/\/execute.*$/, ""));
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

/** Account cards fold to one line (ver_96): open the page with every card, and the Mini game's sections, open. */
export async function openAccount(page: Page, hash = "") {
  await page.goto(`/account${hash}`);
  const openAll = page.getByRole("button", { name: "Open all", exact: true });
  await expect(openAll.or(page.getByRole("button", { name: "Close all", exact: true })).first()).toBeVisible();
  // The account's Open all first, then any inside the Mini game card.
  for (let i = 0; i < 3 && (await openAll.count()) > 0; i++) {
    await openAll.first().click();
    await page.waitForTimeout(200);
  }
}
