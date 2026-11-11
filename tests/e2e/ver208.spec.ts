import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { openAccount, signIn } from "./auth";

// ver_208: the 80s retrowave look, its hint about Chakra Petch, Chakra Petch as an optional
// Text font for anyone, and tag text that stays readable on the dark looks.

const EMAIL = "lead@example.com";
const TAG_COLORS = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#db2777", "#0d9488", "#475569", "#65a30d", "#0891b2"];
const AXE = require.resolve("axe-core/axe.min.js");
test.describe.configure({ mode: "serial" });

const reset = async () => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { look: "classic", riskLook: null, fontBody: "poppins", fontHeading: "bungee" } });
  } finally {
    await db.$disconnect();
  }
};
test.beforeAll(reset);
test.afterAll(reset);

/** Puts one tag pill per tag color on the page (the same markup TagPill draws) and runs axe's contrast check on them. */
async function tagContrast(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (colors) => {
    const box = document.createElement("div");
    box.id = "tag-check";
    box.style.cssText = "position:relative;z-index:50;padding:8px;background:var(--color-surface)";
    for (const c of colors) {
      const s = document.createElement("span");
      s.className = "fp-tag inline-flex rounded-full px-1.5 text-[11px] font-semibold";
      s.style.background = `color-mix(in oklab, ${c} 16%, var(--color-surface))`;
      s.style.color = `color-mix(in oklab, ${c} var(--tag-ink, 62%), var(--color-slate-900))`;
      s.style.setProperty("--tag-c", c);
      s.textContent = `tag ${c}`;
      box.append(s);
    }
    document.querySelector("main")!.prepend(box);
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run("#tag-check", { runOnly: ["color-contrast"] });
    box.remove();
    return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, TAG_COLORS);
}

test("80s retrowave: its own dark screen, Righteous titles, a hint about the text font, and the text font never changes by itself", async ({ page }) => {
  await signIn(page, EMAIL);
  await openAccount(page);
  const html = page.locator("html");
  const picker = page.getByTestId("look-picker");
  await expect(page.getByTestId("retro-font-hint")).toHaveCount(0);
  await picker.getByText("80s retrowave", { exact: true }).click();
  await expect(html).toHaveAttribute("data-look", "retro");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("look-sets-mode")).toHaveText("80s retrowave has its own dark screen. Pick Classic to choose light or dark.");
  await expect(page.getByTestId("retro-font-hint")).toHaveText("Want 80s text too? Pick Chakra Petch under Text font.");
  // Titles in Righteous; the text font stays the person's own.
  await expect.poll(() => html.evaluate((e) => getComputedStyle(e).getPropertyValue("--font-head"))).toContain("Righteous");
  await expect.poll(() => html.evaluate((e) => getComputedStyle(e).getPropertyValue("--font-body"))).toContain("Poppins");
  await expect(page.getByLabel("Text font")).toHaveValue("poppins");
  // The look's title font shows in Heading font, where it can be changed (ver_221).
  await expect(page.getByLabel("Heading font")).toHaveValue("righteous");
  // The sun and grid never take clicks.
  for (const pseudo of ["::before", "::after"]) {
    expect(await page.evaluate((p) => getComputedStyle(document.body, p).pointerEvents, pseudo)).toBe("none");
  }
  // Every tag color reads on the dark screen.
  expect(await tagContrast(page)).toEqual([]);
  await picker.getByText("Classic", { exact: true }).click();
  await expect(html).not.toHaveAttribute("data-look", /./);
  await expect(page.getByTestId("retro-font-hint")).toHaveCount(0);
});

test("Chakra Petch is a Text font anyone can pick, with any look", async ({ page }) => {
  await signIn(page, EMAIL);
  await openAccount(page);
  const text = page.getByLabel("Text font");
  await expect(text.locator('optgroup[label="Fun"] option[value="chakra-petch"]')).toHaveText("Chakra Petch");
  await text.selectOption("chakra-petch");
  await expect.poll(() => page.locator("html").evaluate((e) => e.style.getPropertyValue("--font-body"))).toContain("Chakra Petch");
  const db = new PrismaClient();
  try {
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: EMAIL } })).fontBody).toBe("chakra-petch");
  } finally {
    await db.$disconnect();
  }
  // Still there after a reload, in Classic.
  await page.reload();
  await expect(page.getByLabel("Text font")).toHaveValue("chakra-petch");
  expect(await page.evaluate(() => document.fonts.check('16px "Chakra Petch"'))).toBe(true);
});

test("tag text is readable in every look, and in Classic light and dark", async ({ page }) => {
  await signIn(page, EMAIL);
  const db = new PrismaClient();
  try {
    for (const look of ["mission", "blue", "arcade", "retro", "hc", "white"]) {
      await db.user.update({ where: { email: EMAIL }, data: { look } });
      await page.goto("/account");
      await expect(page.locator("html")).toHaveAttribute("data-look", look);
      expect(await tagContrast(page), look).toEqual([]);
    }
    // ver_209: Classic, light and dark.
    await db.user.update({ where: { email: EMAIL }, data: { look: "classic" } });
    for (const theme of ["light", "dark"]) {
      await page.goto("/account");
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      expect(await tagContrast(page), `classic ${theme}`).toEqual([]);
    }
  } finally {
    await db.$disconnect();
  }
});

test("on a phone the 80s retrowave look fits with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAIL);
  const db = new PrismaClient();
  await db.user.update({ where: { email: EMAIL }, data: { look: "retro" } });
  await db.$disconnect();
  for (const path of ["/account", "/"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-look", "retro");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
  }
});
