import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { openAccount, signIn } from "./auth";

// ver_202: app-wide looks (Your account → How it looks → Appearance → Look). Only colors,
// borders and fonts change; the Risk board follows the look unless it has its own.

const EMAIL = "lead@example.com";
const LOOKS: [string, string, string | null][] = [
  ["Mission control", "mission", "dark"],
  ["High contrast", "hc", "light"],
  ["Whiteboard", "white", "light"],
  ["Blueprint", "blue", "dark"],
  ["Arcade", "arcade", "dark"],
  ["80s retrowave", "retro", "dark"],
];
test.describe.configure({ mode: "serial" });
const AXE = require.resolve("axe-core/axe.min.js");

async function contrastProblems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run("main", { runOnly: ["color-contrast"] });
    return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message}`));
  });
}

const savedLook = async () => {
  const db = new PrismaClient();
  try {
    const u = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    return [u.look, u.riskLook];
  } finally {
    await db.$disconnect();
  }
};

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { look: "classic", riskLook: null } });
  } finally {
    await db.$disconnect();
  }
});

test("each person picks a look for the whole app; Light and dark only apply to Classic", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, EMAIL);
  await openAccount(page);
  const html = page.locator("html");
  const picker = page.getByTestId("look-picker");
  await expect(picker.getByRole("radio", { name: "Classic" })).toBeChecked();
  await expect(html).not.toHaveAttribute("data-look", /./);

  for (const [label, id, mode] of LOOKS) {
    await picker.getByText(label, { exact: true }).click();
    await expect(html).toHaveAttribute("data-look", id);
    if (mode) await expect(html).toHaveAttribute("data-theme", mode);
    await expect.poll(async () => (await savedLook())[0]).toBe(id);
    // The look comes back after a reload, drawn by the server.
    await page.reload();
    await expect(html).toHaveAttribute("data-look", id);
    await expect(page.getByTestId("look-sets-mode")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Dark" })).toBeDisabled();
    expect(await contrastProblems(page), label).toEqual([]);
  }
  // High contrast turns on shapes; Blueprint's font is for everything.
  await picker.getByText("High contrast", { exact: true }).click();
  await expect(html).toHaveAttribute("data-shapes", "on");

  await picker.getByText("Classic", { exact: true }).click();
  await expect(html).not.toHaveAttribute("data-look", /./);
  await expect(page.getByTestId("look-sets-mode")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Dark" })).toBeEnabled();
  await expect.poll(async () => (await savedLook())[0]).toBe("classic");
});

test("the Risk board follows the look unless it has its own", async ({ page }) => {
  // Start from "Same as my look", whatever other specs left behind.
  const db = new PrismaClient();
  await db.user.update({ where: { email: EMAIL }, data: { riskLook: null } });
  await db.$disconnect();
  await signIn(page, EMAIL);
  await openAccount(page);
  const risk = page.getByTestId("risk-look-picker");
  await expect(risk.getByRole("radio", { name: "Same as my look" })).toBeChecked();
  await risk.getByText("Arcade", { exact: true }).click();
  await expect.poll(async () => (await savedLook())[1]).toBe("arcade");
  await risk.getByText("Same as my look", { exact: true }).click();
  await expect.poll(async () => (await savedLook())[1]).toBe(null);
});

test("on a phone every look fits with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAIL);
  const db = new PrismaClient();
  try {
    for (const [, id] of LOOKS) {
      await db.user.update({ where: { email: EMAIL }, data: { look: id } });
      await page.goto("/account");
      await expect(page.locator("html")).toHaveAttribute("data-look", id);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), id).toBeLessThanOrEqual(0);
    }
  } finally {
    await db.user.update({ where: { email: EMAIL }, data: { look: "classic" } });
    await db.$disconnect();
  }
});
