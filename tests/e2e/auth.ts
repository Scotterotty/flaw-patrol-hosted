import { expect, type Page } from "@playwright/test";

export const PASSWORD = "flaw patrol e2e password";

const handled = new WeakSet<Page>();

/** Sign in, setting the password first if this account doesn't have one yet. */
export async function signIn(page: Page, email: string, name = "", password = PASSWORD) {
  // The What's new window opens once per version after sign-in (ver_88); close it whenever it shows up.
  if (!handled.has(page)) {
    handled.add(page);
    await page.addLocatorHandler(page.getByTestId("whats-new-window"), async (w) => {
      await w.getByRole("button", { name: "Close", exact: true }).click();
    });
  }
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  const create = page.getByLabel("Confirm password");
  const existing = page.getByLabel("Password", { exact: true });
  await expect(create.or(existing)).toBeVisible();
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
