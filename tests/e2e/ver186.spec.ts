import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_186: tab rows never show a scrollbar (Windows drew an up/down bar at the right end of
// every row), the line under the row stays, the selected tab's underline is whole, and on a
// narrow window the › slides the row along.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `TB${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.user.update({ where: { id: admin.id }, data: { whatsNewSeen: 999 } });
    await db.project.create({ data: { key: KEY, name: `Tabs ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
});

/** Every tab row on the page scrolls sideways only, and draws no scrollbar. */
const noTabScrollbars = async (page: Page, name: string) => {
  const row = page.getByRole("navigation", { name });
  await expect(row).toBeVisible();
  const look = await row.evaluate((el: HTMLElement) => {
    const s = getComputedStyle(el);
    const active = el.querySelector<HTMLElement>("[aria-current=page], .font-medium");
    return {
      upDown: el.scrollHeight - el.clientHeight,
      overflowY: s.overflowY,
      barWidth: s.scrollbarWidth,
      bars: el.offsetHeight - el.clientHeight,
      line: s.boxShadow,
      underline: active ? active.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom : null,
    };
  });
  expect(look.upDown).toBe(0);
  expect(look.overflowY).toBe("hidden");
  expect(look.barWidth).toBe("none");
  expect(look.bars).toBe(0);
  expect(look.line).toContain("inset");
  // The selected tab's underline sits right on the row's bottom edge, not cut off below it.
  if (look.underline !== null) expect(Math.abs(look.underline)).toBeLessThanOrEqual(0.5);
};

test("tab rows on wide screens have no scrollbar and keep their line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/reports`);
  await noTabScrollbars(page, "Report views");
  await page.goto(`/p/${KEY}/cases`);
  await noTabScrollbars(page, "Case state");
  await page.goto(`/p/${KEY}/runs`);
  await noTabScrollbars(page, "Run state");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Reports tabs slide along with the › and still show no scrollbar", async ({ page }) => {
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto(`/p/${KEY}/reports`);
    await noTabScrollbars(page, "Report views");
    const row = page.getByRole("navigation", { name: "Report views" });
    const more = row.locator("xpath=..").getByTestId("more-tabs");
    await expect(more).toBeVisible();
    await more.click();
    await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
