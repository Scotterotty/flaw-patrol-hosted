import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_225: Invite people on the bash board, so the join link (Copy link, QR code) is there the
// whole time the bash is on, not just in the box after Start. Who's where points to it too,
// the link lets someone in after the start, it goes away once the bash ends, phones, and
// Lighthouse's checks in every look.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const AXE = require.resolve("axe-core/axe.min.js");
const RULES = ["aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "link-in-text-block", "heading-order", "target-size", "color-contrast", "button-name", "nested-interactive"];

async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document, { runOnly: { type: "rule", values: rules } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, RULES);
}

test("Invite people brings back the join link on a running bash", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const KEY = `IV${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Invite ${TAG}`, KEY);

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Invite bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  // The box after Start still has its link, Copy link and QR code.
  await expect(box.getByRole("heading", { name: "Your bash is live. Invite people." })).toBeVisible({ timeout: 20_000 });
  await expect(box.getByLabel("Join link")).toHaveValue(/\/bashes\/[^/]+\?join=1$/);
  await expect(box.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(box.getByRole("button", { name: "Show QR code" })).toBeVisible();
  await box.getByRole("link", { name: "Open the bash" }).click();

  // On the board: Invite people next to the timer, closed to start with.
  const invite = page.getByRole("button", { name: "Invite people", exact: true });
  await expect(invite).toBeVisible();
  await expect(invite).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("board-invite")).toHaveCount(0);
  await invite.click();
  const panel = page.getByTestId("board-invite");
  await expect(panel).toBeVisible();
  await expect(invite).toHaveAttribute("aria-expanded", "true");
  const link = await panel.getByLabel("Join link").inputValue();
  expect(link).toMatch(new RegExp(`/p/${KEY}/bashes/[^/]+\\?join=1$`));
  expect(link).toContain(page.url().replace(/\?.*$/, ""));
  await panel.getByRole("button", { name: "Copy link" }).click();
  await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
  await panel.getByRole("button", { name: "Show QR code" }).click();
  await expect(panel.getByRole("img", { name: "QR code for the join link" })).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);

  // Who's where, before anyone joins, opens the same box.
  await expect(page.getByText("Nobody has joined yet.")).toBeVisible();
  await page.getByRole("button", { name: "invite people", exact: true }).click();
  await expect(page.getByTestId("board-invite")).toBeVisible();

  // Someone not on the team opens the link after the start and lands on Pick an area.
  const other = await browser.newContext();
  try {
    const p2 = await other.newPage();
    await signIn(p2, "lead@example.com", "Demo Lead");
    await p2.goto(link);
    await expect(p2.getByRole("radiogroup", { name: "Area" })).toBeVisible();
  } finally {
    await other.close();
  }

  // Lighthouse's checks with the box open, in light, dark and the looks.
  const db = new PrismaClient();
  try {
    for (const [mode, look] of [["light", "classic"], ["dark", "classic"], ["light", "hc"], ["dark", "mission"], ["dark", "retro"], ["light", "white"], ["light", "blue"], ["dark", "arcade"]]) {
      await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: mode, look } });
      await page.reload();
      await page.getByRole("button", { name: "Invite people", exact: true }).click();
      await expect(page.getByTestId("board-invite")).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Off the button: axe reads its hover color, which every primary button shares.
      await page.mouse.move(0, 0);
      expect(await problems(page), `${mode} ${look}`).toEqual([]);
    }
  } finally {
    await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: "light", look: "classic" } });
    await db.$disconnect();
  }

  // Phones: the button fits, the box fits, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Invite people", exact: true }).click();
  const small = page.getByTestId("board-invite");
  await expect(small.getByRole("button", { name: "Copy link" })).toBeInViewport();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(wide).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Once the bash ends, Invite people goes away.
  await page.reload();
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await expect(page.getByRole("button", { name: "Invite people", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("board-invite")).toHaveCount(0);
});
