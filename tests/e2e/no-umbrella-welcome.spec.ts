import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_258: someone signed in who isn't on any umbrella gets a welcome page with two choices.
// Join your team names the workspace admins and sends Ask to be added, which admins answer in
// Workspace settings. Make your first umbrella opens the How-to guide on its own and walks
// them through, and a name that's already taken offers Ask to join instead.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

async function newPerson(email: string, name: string) {
  const db = new PrismaClient();
  try {
    await db.user.upsert({ where: { email }, create: { email, name, whatsNewSeen: 999 }, update: {} });
  } finally {
    await db.$disconnect();
  }
}

async function makeUmbrella(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: /^(New umbrella|Make your first umbrella)$/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Product name").fill(name);
  await box.getByRole("button", { name: `Make ${name}` }).click();
  await expect(page).toHaveURL(/\/g\/[^/]+$/);
}

test("Ask to be added: an admin adds them from Workspace settings and their page opens the umbrella", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const umbrella = `Lantern ${TAG}`;
  const email = `wren.${TAG.toLowerCase()}@example.com`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await makeUmbrella(page, umbrella);
  await newPerson(email, `Wren ${TAG}`);

  const ctx = await browser.newContext();
  const w = await ctx.newPage();
  await signIn(w, email, `Wren ${TAG}`);
  await w.goto("/");
  await expect(w.getByRole("heading", { name: "Welcome, Wren" })).toBeVisible();
  const join = w.getByRole("region", { name: "Join your team" });
  await expect(join.getByRole("list", { name: "Admins" })).toContainText("Demo Admin");
  await join.getByRole("button", { name: "Ask to be added" }).click();
  await expect(join.getByTestId("asked-to-be-added")).toContainText("Sent to");
  await expect(join.getByTestId("asked-to-be-added")).toContainText("This page opens your umbrella as soon as");

  // The admin's red dot leads to Workspace settings → Waiting to be added.
  await page.goto("/");
  await expect(page.getByTestId("join-dot")).toBeVisible();
  await page.getByTitle("admin@example.com · your account").click();
  await page.getByRole("menuitem", { name: /waiting to be added/ }).click();
  await expect(page).toHaveURL(/\/workspace#waiting$/);
  const waiting = page.getByRole("region", { name: "Waiting to be added" });
  const row = waiting.getByTestId("waiting-person").filter({ hasText: `Wren ${TAG}` });
  await expect(row.getByRole("button", { name: "Add" })).toBeDisabled();
  await row.getByLabel(`Umbrella for Wren ${TAG}`).selectOption({ label: umbrella });
  await row.getByLabel(`Role for Wren ${TAG}`).selectOption({ label: "Member" });
  await row.getByRole("button", { name: "Add" }).click();
  await expect(row).toHaveCount(0);

  // Wren's page notices by itself and shows the umbrella.
  await expect(w.getByTestId("welcome-home")).toHaveCount(0, { timeout: 20_000 });
  await w.goto("/");
  await expect(w.getByText(umbrella).first()).toBeVisible();
  await ctx.close();
});

test("Make your first umbrella walks them through in the How-to guide and catches a name that's taken", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const taken = `Harbor ${TAG}`;
  const fresh = `Comet ${TAG}`;
  const email = `ash.${TAG.toLowerCase()}@example.com`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await makeUmbrella(page, taken);
  await newPerson(email, `Ash ${TAG}`);

  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await signIn(a, email, `Ash ${TAG}`);
  await a.goto("/");
  await a.getByRole("region", { name: "Start a new product" }).getByRole("button", { name: "Make your first umbrella" }).click();

  // How-to mode: the guide opens on Your first 10 minutes with the Product name box glowing.
  const guide = a.locator("[data-howto-panel]");
  await expect(guide).toContainText("Your first 10 minutes");
  const box = a.getByRole("dialog");
  const nameBox = box.getByLabel("Product name");
  await expect(nameBox).toHaveClass(/fp-howto-glow/);
  await expect(nameBox).toBeFocused();

  // A name that's already here: Ask to join it instead.
  await nameBox.fill(taken.toLowerCase());
  const clash = box.getByTestId("umbrella-clash");
  await expect(clash).toContainText(`There's already an umbrella called ${taken}.`);
  await expect(box.getByRole("button", { name: /^Make / })).toBeDisabled();
  await clash.getByRole("button", { name: `Ask to join ${taken}` }).click();
  await expect(clash).toContainText("you've asked to join it");

  // A new name, then straight to Make: the umbrella opens and the guide carries on to Start here.
  await nameBox.fill(fresh);
  await expect(clash).toHaveCount(0);
  await box.getByRole("button", { name: `Make ${fresh}` }).click();
  await expect(a).toHaveURL(/\/g\/[^/]+$/);
  await expect(a.locator('[data-howto="start-here"]').first()).toHaveClass(/fp-howto-glow/);
  await expect(guide).toContainText("Your first 10 minutes");
  await ctx.close();
  // Take back Ash's request to join, so other specs' admins only see their own.
  const db = new PrismaClient();
  try {
    await db.joinRequest.deleteMany({ where: { user: { email } } });
  } finally {
    await db.$disconnect();
  }
});

test("the welcome page's practice run and How-to task work without an umbrella", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = `kit.${TAG.toLowerCase()}@example.com`;
  await newPerson(email, `Kit ${TAG}`);
  const ctx = await browser.newContext();
  const k = await ctx.newPage();
  await signIn(k, email, `Kit ${TAG}`);
  await k.goto("/");
  await k.getByTestId("welcome-how-to").click();
  await expect(k.locator("[data-howto-panel]")).toContainText("No umbrella yet? Get started");
  await k.getByRole("button", { name: "Try a 2-minute practice run" }).click();
  await expect(k).toHaveURL(/\/runs\/1\/execute/);
  await k.goto("/");
  await expect(k.getByRole("button", { name: "Continue your practice run" })).toBeVisible();
  await ctx.close();
});
