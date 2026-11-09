import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_209: the main pages pass the accessibility checks Lighthouse failed them on before
// (skip link target, resize handles, tag filter links, links that rely on color, small buttons,
// heading order, the Search button's name, text contrast). Lighthouse runs the same axe rules.

const RULES = ["skip-link", "aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "link-in-text-block", "heading-order", "target-size", "color-contrast"];
const PAGES = ["/", "/account", "/p/SHOP", "/p/SHOP/cases", "/p/SHOP/bugs", "/p/SHOP/settings"];
const AXE = require.resolve("axe-core/axe.min.js");

async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document, { runOnly: { type: "rule", values: rules } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, RULES);
}

test("the main pages pass Lighthouse's accessibility checks, in light and dark", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "lead@example.com");
  const db = new PrismaClient();
  try {
    for (const theme of ["light", "dark"]) {
      // Saved on the account, so the page draws in that mode from the start (no color fade mid-check).
      await db.user.update({ where: { email: "lead@example.com" }, data: { themeMode: theme, look: "classic" } });
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await problems(page), `${theme} ${path}`).toEqual([]);
      }
    }
  } finally {
    await db.user.update({ where: { email: "lead@example.com" }, data: { themeMode: "light" } });
    await db.$disconnect();
  }
});

test("Skip to content lands on the page's main area", async ({ page }) => {
  await signIn(page, "lead@example.com");
  await page.goto("/p/SHOP/cases");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});
