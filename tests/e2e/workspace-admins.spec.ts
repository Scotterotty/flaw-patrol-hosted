import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Workspace admins (Nov 13): Workspace settings → Admins lists the workspace admins. An admin
// makes someone else one (after a box that says what they'll be able to do), or takes it away.

const TAG = Date.now().toString(36).slice(-5);
const email = `wsadmin-${TAG}@example.com`;
const name = `Katie Admin${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.create({ data: { email, name } });
  } finally {
    await db.$disconnect();
  }
});

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ where: { email }, data: { isAdmin: false } });
  } finally {
    await db.$disconnect();
  }
});

test("a workspace admin makes someone else an admin, and they can remove themselves", async ({ page, browser }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/workspace");
  const tabs = page.getByRole("navigation", { name: "Workspace sections" });
  await expect(tabs.getByRole("link").first()).toHaveText("Admins");
  const card = page.getByRole("region", { name: "Workspace admins" });
  const list = card.getByRole("list", { name: "Workspace admins" });
  await expect(list.getByRole("listitem").filter({ hasText: "admin@example.com" })).toContainText("You");
  await expect(list).not.toContainText(email);

  // Type part of the name, pick them, then confirm in the box.
  await card.getByLabel("Person to make a workspace admin").fill(`admin${TAG}`);
  await card.getByRole("list", { name: "Matching people" }).getByRole("button", { name: new RegExp(name) }).click();
  await card.getByRole("button", { name: "Make admin" }).click();
  const box = page.getByRole("dialog", { name: `Make ${name} a workspace admin?` });
  await expect(box).toContainText("Katie will be able to:");
  await expect(box).toContainText("Update Flaw Patrol with the Update button");
  await box.getByRole("button", { name: "Make admin" }).click();
  await expect(list.getByRole("listitem").filter({ hasText: email })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const db = new PrismaClient();
  try {
    expect((await db.user.findUniqueOrThrow({ where: { email } })).isAdmin).toBe(true);
    const logged = await db.activityEntry.findFirst({ where: { action: `Made ${name} a workspace admin` } });
    expect(logged?.actorLabel).toBe("Demo Admin");
  } finally {
    await db.$disconnect();
  }

  // The new admin gets Workspace settings, and can step down; then the page is gone for them.
  const ctx = await browser.newContext();
  const k = await ctx.newPage();
  await signIn(k, email, name);
  await k.goto("/workspace");
  const theirs = k.getByRole("region", { name: "Workspace admins" });
  const mine = theirs.getByRole("list", { name: "Workspace admins" }).getByRole("listitem").filter({ hasText: email });
  await expect(mine).toContainText("You");
  await mine.getByRole("button", { name: `Remove ${name} as a workspace admin` }).click();
  await expect(mine).toContainText("Stop being a workspace admin?");
  await mine.getByRole("button", { name: "Remove admin" }).click();
  await expect(k).not.toHaveURL(/\/workspace/);
  expect((await k.goto("/workspace"))?.status()).toBe(404);
  await ctx.close();

  // Back on the first admin's page, they're gone from the list.
  await page.reload();
  await expect(list).not.toContainText(email);
});
