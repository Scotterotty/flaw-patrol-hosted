import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// How-to guide scroll bars (Scott, Nov 13 2026): with the guide open on a computer, the page's scroll
// bar sat at the window edge right beside the guide's own bar. Now the page scrolls in <body>, which
// ends where the guide starts, so each bar sits beside what it scrolls. Opening and closing the guide
// keeps your place on the page, and phones keep the guide as a sheet at the bottom.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const ids = { group: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: `HS${TAG}`, name: `Scroll ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const group = await db.projectGroup.create({ data: { name: `Scroll ${TAG}`, hubProjectId: hub.id, platforms: [{ name: "Web" }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
  } finally {
    await db.$disconnect();
  }
});

test("the page's scroll bar sits at the page's edge while the How-to guide is open", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 });
  await signIn(page, "admin@example.com");
  await page.goto(`/g/${ids.group}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  // Settings is taller than the window: scroll down a bit first.
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

  await page.getByTestId("menu-how-to").first().click();
  const guide = page.getByTestId("how-to-guide");
  await expect(guide).toBeVisible();

  const look = () =>
    page.evaluate(() => {
      const b = document.body;
      const panel = document.querySelector<HTMLElement>("[data-howto-panel]");
      return {
        bodyScrolls: getComputedStyle(b).overflowY,
        bodyRight: Math.round(b.getBoundingClientRect().right),
        panelLeft: panel ? Math.round(panel.getBoundingClientRect().left) : -1,
        windowY: window.scrollY,
        bodyY: b.scrollTop,
      };
    });
  // The page scrolls in <body>, which stops at the guide's left edge; the window itself doesn't scroll.
  const open = await look();
  expect(open.bodyScrolls).toBe("auto");
  expect(open.bodyRight).toBe(open.panelLeft);
  expect(open.windowY).toBe(0);
  // Same place on the page as before the guide opened.
  expect(open.bodyY).toBe(400);

  // Scrolling the page with the guide open moves the page, not the guide.
  await page.mouse.move(500, 500);
  await page.mouse.wheel(0, 300);
  await expect.poll(async () => (await look()).bodyY).toBeGreaterThan(400);
  const y = (await look()).bodyY;

  // Closing the guide hands the scroll back to the window, still at the same place.
  await guide.getByRole("button", { name: "Close the How-to guide" }).click();
  await expect(guide).toHaveCount(0);
  const closed = await look();
  expect(closed.bodyScrolls).not.toBe("auto");
  expect(closed.windowY).toBe(y);
});

test("on a phone the How-to guide stays a sheet at the bottom and the window scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, "admin@example.com");
  await page.goto(`/g/${ids.group}/settings`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  // On a phone How-to guide is on the bottom menu bar.
  await page.getByTestId("menu-how-to").locator("visible=true").first().click();
  await expect(page.getByTestId("how-to-guide")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).not.toBe("auto");
});
