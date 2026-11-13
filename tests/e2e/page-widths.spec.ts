import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_233: every page is centered beside the menu and uses one of three widths
// (globals.css .page-settings 896 px, .page-list 1152 px, .page-reading 672 px).
// Checked on a laptop and a big monitor; phones never scroll sideways.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `PW${TAG}`;
const CYCLE = `PC${TAG}`;
const NAME = `Widths ${TAG}`;
// A test cycle on its own (not in an umbrella) has its own Settings page.
const SOLO = `PS${TAG}`;
let groupId = "";

const WIDTH = { settings: 896, list: 1152, reading: 672 } as const;
type Tier = keyof typeof WIDTH;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 1`, groupId, platform: "Web", rcName: "RC 1", members: { create: { userId: admin.id, role: "ADMIN" } } } });
    await db.project.create({ data: { key: SOLO, name: `Solo ${TAG}`, members: { create: { userId: admin.id, role: "ADMIN" } } } });
  } finally {
    await db.$disconnect();
  }
});

function pages(): [string, Tier][] {
  return [
    ["/account", "settings"],
    ["/workspace", "settings"],
    [`/p/${SOLO}/settings`, "settings"],
    [`/g/${groupId}/settings`, "settings"],
    ["/whats-new", "reading"],
    ["/leaderboard", "reading"],
    ["/", "list"],
    [`/g/${groupId}`, "list"],
    [`/g/${groupId}/runs`, "list"],
    [`/p/${CYCLE}/runs`, "list"],
    [`/p/${CYCLE}/bugs`, "list"],
    [`/p/${CYCLE}/reports`, "list"],
  ];
}

/** The page's box: its width and the gaps on each side inside the space it sits in. */
async function measure(page: Page) {
  const box = page.locator("main .page, main.page").first();
  await expect(box, page.url()).toBeVisible();
  return box.evaluate((el) => {
    const parent = el.parentElement!;
    const p = parent.getBoundingClientRect();
    const cs = getComputedStyle(parent);
    const r = el.getBoundingClientRect();
    return {
      width: Math.round(r.width),
      room: Math.round(p.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
      left: r.left - (p.left + parseFloat(cs.paddingLeft)),
      right: p.right - parseFloat(cs.paddingRight) - r.right,
    };
  });
}

for (const [label, viewport] of [
  ["laptop", { width: 1440, height: 900 }],
  ["monitor", { width: 1920, height: 1080 }],
] as const) {
  test(`every page is centered and one of the 3 widths on a ${label}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(viewport);
    await signIn(page, "admin@example.com", "Demo Admin");
    for (const [url, tier] of pages()) {
      await page.goto(url);
      const m = await measure(page);
      // Exactly the tier's width, or all the room there is when the screen is narrower than that.
      expect(m.width, `${url} width`).toBe(Math.min(WIDTH[tier], m.room));
      expect(Math.abs(m.left - m.right), `${url} centered (left ${m.left}, right ${m.right})`).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${url} no sideways scroll`).toBe(true);
    }
  });
}

test("phones never scroll sideways", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "admin@example.com", "Demo Admin");
  for (const [url] of pages()) {
    await page.goto(url);
    await expect(page.locator("main").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${url} on a phone`).toBe(true);
  }
});

test("Your account: text boxes stay a sensible width and every Show me finds its card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account");
  // Cards remember being open, so another test may have opened them already.
  const openAll = page.getByRole("button", { name: "Open all", exact: true });
  await expect(openAll.or(page.getByRole("button", { name: "Close all", exact: true }))).toBeVisible();
  if (await openAll.isVisible()) await openAll.click();
  const name = page.getByRole("textbox", { name: "Your name" });
  await expect(name).toBeVisible();
  expect((await name.boundingBox())!.width).toBeLessThanOrEqual(448);
  for (const howto of ["account-profile", "account-password", "account-jira", "account-accessibility", "account-language", "account-layout", "account-emails"]) {
    await expect(page.locator(`[data-howto="${howto}"]`), howto).toBeVisible();
  }
});

test("the Reproduction history preview in a bug template fits without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${SOLO}/settings`);
  const section = page.getByTestId("bug-templates");
  await section.getByRole("button", { name: "New template" }).click();
  const start = page.getByRole("dialog", { name: "New template" });
  await start.getByLabel("Name").fill("Widths check");
  await start.getByRole("button", { name: "Next" }).click();
  const editor = page.getByTestId("template-editor");
  await editor.getByRole("button", { name: "+ Add heading" }).click();
  const heads = editor.getByTestId("template-heading");
  const last = heads.last();
  await last.getByLabel("Heading name").fill("Repro history");
  await last.getByLabel("Where Repro history's text comes from").selectOption({ label: "A table" });
  const table = editor.getByTestId("template-preview-form").locator("table").first();
  await expect(table).toBeVisible();
  const box = await table.evaluate((t) => ({ scroll: t.parentElement!.scrollWidth, room: t.parentElement!.clientWidth }));
  expect(box.scroll, `preview needs ${box.scroll} px, has ${box.room} px`).toBeLessThanOrEqual(box.room + 1);
});
