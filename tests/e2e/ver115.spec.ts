import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_115 (persona audit findings #2 and #3): shared links for people outside the team. A live
// bug bash link lets anyone signed in join; other links say what they are and offer Ask to
// join; admins Add or Ignore at the top of Members; someone on no team gets a waiting page.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `J${TAG}`;
const NAME = `Storefront ${TAG}`;
const RILEY = `riley.${TAG.toLowerCase()}@example.com`;

async function newPerson(email: string, name: string) {
  const db = new PrismaClient();
  try {
    await db.user.upsert({ where: { email }, create: { email, name, whatsNewSeen: 999 }, update: {} });
  } finally {
    await db.$disconnect();
  }
}

async function startBash(page: Page) {
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Checkout ${TAG}`);
  await box.getByLabel("Add an area").fill("Cart");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box.getByRole("link", { name: "Open the bash" })).toBeVisible();
  const db = new PrismaClient();
  try {
    return (await db.bugBash.findFirstOrThrow({ where: { project: { key: KEY } }, orderBy: { createdAt: "desc" } })).id;
  } finally {
    await db.$disconnect();
  }
}

test("someone outside the team joins a live bash, asks to join, and an admin adds them", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, NAME, KEY);
  const bashId = await startBash(page);
  await newPerson(RILEY, `Riley ${TAG}`);

  const ctx = await browser.newContext();
  const r = await ctx.newPage();
  await signIn(r, RILEY, `Riley ${TAG}`);

  // Not on any team yet: the home page says how to get in, with Make an umbrella as a small link.
  await r.goto("/");
  await expect(r.getByText("Waiting to be added?")).toBeVisible();
  await expect(r.getByText("Ask whoever invited you for your invite link.")).toBeVisible();
  await expect(r.getByRole("button", { name: "Make an umbrella" })).toBeVisible();
  await expect(r.getByText("Start with an umbrella")).toHaveCount(0);

  // A live bug bash link: straight in, this bash only.
  await r.goto(`/p/${KEY}/bashes/${bashId}`);
  await expect(r).toHaveURL(new RegExp(`/bashes/${bashId}/join`));
  await expect(r.getByText("You'll see this bug bash only.")).toBeVisible();
  await expect(r.getByText(`Demo Admin started this bug bash in ${NAME}.`)).toBeVisible();
  await r.getByRole("radio").first().check();
  await r.getByRole("button", { name: "Start exploring" }).click();
  await r.getByLabel("What did you find?").fill(`Coupon box ignores Enter ${TAG}`);
  await r.getByRole("button", { name: "Log bug" }).click();
  await expect(r.getByText(`Coupon box ignores Enter ${TAG}`).first()).toBeVisible();

  // Any other link: what it is, who the admins are, and Ask to join.
  await r.goto(`/p/${KEY}/cases`);
  await expect(r).toHaveURL(/\/access\?to=/);
  await expect(r.getByRole("heading", { name: "You're not on this team yet" })).toBeVisible();
  await expect(r.getByText(`This link opens the Case library in ${NAME}. Its admin is Demo Admin.`)).toBeVisible();
  await expect(r.getByRole("link", { name: "Go to my home page" })).toBeVisible();
  await r.getByRole("button", { name: "Ask to join" }).click();
  await expect(r.getByRole("status")).toContainText("Request sent. Demo Admin will see it. You'll get access as soon as they say yes.");

  // Home now shows the request, with Cancel request.
  await r.goto("/");
  await expect(r.getByText(`Waiting to join ${NAME}`)).toBeVisible();
  await expect(r.getByRole("button", { name: "Cancel request" })).toBeVisible();

  // A link that truly doesn't exist still says Not found, with the new wording.
  await r.goto(`/p/NOPE${TAG}/cases`);
  await expect(r.getByRole("heading", { name: "Not found" })).toBeVisible();
  await expect(r.getByRole("link", { name: "Go to my home page" })).toBeVisible();
  await r.goto("/");

  // The admin sees a dot, and the request on top of Members.
  await page.goto(`/p/${KEY}`);
  await expect(page.getByTestId("join-dot")).toBeVisible();
  await page.getByTitle("admin@example.com · your account").click();
  await page.getByRole("menuitem", { name: /asking to join/ }).click();
  await expect(page).toHaveURL(/\/settings#members/);
  const ask = page.getByRole("region", { name: "Asking to join" }).locator("div").filter({ hasText: `Riley ${TAG} wants to join ${NAME}` }).first();
  await expect(ask).toContainText(`${RILEY} · opened the Case library link`);
  await ask.getByLabel(`Role for ${RILEY}`).selectOption("VIEWER");
  await ask.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(`Riley ${TAG} wants to join`)).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: RILEY })).toBeVisible();

  // Riley's waiting page updates by itself once they're added.
  await expect(r.getByText(NAME).first()).toBeVisible({ timeout: 15_000 });
  await expect(r.getByText(`Waiting to join ${NAME}`)).toHaveCount(0);
  await r.goto(`/p/${KEY}/cases`);
  await expect(r).toHaveURL(new RegExp(`/p/${KEY}/cases`));
  await ctx.close();
});

test("Ignore drops a request, and a bash that's over offers Ask to join", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const key2 = `K${TAG}`;
  const sam = `sam.${TAG.toLowerCase()}@example.com`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Ended ${TAG}`, key2);
  await page.goto(`/p/${key2}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Over ${TAG}`);
  await box.getByLabel("Add an area").fill("Home");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box.getByRole("link", { name: "Open the bash" })).toBeVisible();
  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { project: { key: key2 } } });
  await db.bugBash.update({ where: { id: bash.id }, data: { endedAt: new Date() } });
  await db.$disconnect();
  await newPerson(sam, `Sam ${TAG}`);

  const ctx = await browser.newContext();
  const s = await ctx.newPage();
  await signIn(s, sam, `Sam ${TAG}`);
  await s.goto(`/p/${key2}/bashes/${bash.id}/join`);
  await expect(s).toHaveURL(/\/access\?to=/);
  await expect(s.getByText(`This link opens a bug bash that's over in Ended ${TAG}.`)).toBeVisible();
  await s.getByRole("button", { name: "Ask to join" }).click();
  await expect(s.getByRole("status")).toContainText("Request sent.");

  await page.goto(`/p/${key2}/settings`);
  const ask = page.getByRole("region", { name: "Asking to join" });
  await expect(ask).toContainText(`Sam ${TAG} wants to join Ended ${TAG}`);
  await expect(ask).toContainText("opened a bug bash link");
  await ask.getByRole("button", { name: "Ignore" }).click();
  await expect(page.getByText(`Sam ${TAG} wants to join`)).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: sam })).toHaveCount(0);

  // Sam's home page no longer shows the request.
  await s.goto("/");
  await expect(s.getByText("Waiting to be added?")).toBeVisible();
  await ctx.close();
});
