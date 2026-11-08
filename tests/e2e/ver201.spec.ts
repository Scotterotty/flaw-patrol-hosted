import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_201: Risk board looks (Your account → Appearance → Risk board look), readable "No tests",
// risk words on every square, and one list riskiest first on a phone.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `RL${TAG}`;
const EMAIL = "lead@example.com";
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const LOOKS: [string, string][] = [
  ["Classic", "classic"],
  ["Mission control", "mission"],
  ["Whiteboard", "white"],
  ["Blueprint", "blue"],
  ["Arcade", "arcade"],
  ["High contrast", "hc"],
];
test.describe.configure({ mode: "serial" });
const AXE = require.resolve("axe-core/axe.min.js");

/** Text on the board passes the 4.5:1 contrast check (axe), in light and dark mode. */
async function contrastProblems(page: Page) {
  await page.addScriptTag({ path: AXE });
  const out: string[] = [];
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((s) => (document.documentElement.dataset.theme = s), scheme);
    const bad = await page.evaluate(async () => {
      // @ts-expect-error axe is added by the script tag
      const r = await window.axe.run("[data-testid=risk-board]", { runOnly: ["color-contrast"] });
      return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message}`));
    });
    out.push(...bad.map((b: string) => `${scheme} ${b}`));
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  return out;
}

async function connectJira(page: Page) {
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
}

async function pickLook(page: Page, look: string, id: string) {
  await page.goto("/account");
  const picker = page.getByTestId("risk-look-picker");
  if (!(await picker.isVisible())) await page.getByRole("button", { name: /Appearance/ }).first().click();
  await picker.getByText(look, { exact: true }).click();
  await expect(picker.getByRole("radio", { name: look })).toBeChecked();
  // Saved on the account, not just in the page.
  const db = new PrismaClient();
  try {
    await expect.poll(async () => (await db.user.findUniqueOrThrow({ where: { email: EMAIL } })).riskLook).toBe(id);
  } finally {
    await db.$disconnect();
  }
}

test.afterAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { riskLook: null } });
  } finally {
    await db.$disconnect();
  }
});

test("each person picks a Risk board look; every look says the risk in words and shows No tests", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, EMAIL);
  await standaloneProject(page, `Looks ${TAG}`, KEY, EMAIL);
  await connectJira(page);

  for (const [look, id] of LOOKS) {
    await pickLook(page, look, id);
    await page.goto(`/p/${KEY}/risk?release=RC%2022`);
    const board = page.getByRole("grid", { name: "Risk board for RC 22" });
    await expect(board).toBeVisible();
    await expect(page.getByTestId("risk-board")).toHaveAttribute("data-risk-look", id);
    // Words, not just color: the top-right square says High risk.
    await expect(board.getByRole("gridcell", { name: /^High likelihood, High impact, high risk/ })).toContainText("High risk");
    // QA-202 has no tests: the red tag is there and at least 11px in every look but Arcade's pixel font.
    const tag = board.getByRole("button", { name: /QA-202/ }).getByText("No tests");
    await expect(tag).toBeVisible();
    if (look !== "Arcade") expect(parseFloat(await tag.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(11);
    expect(await contrastProblems(page), look).toEqual([]);
    if (process.env.SHOTS) {
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate((s) => (document.documentElement.dataset.theme = s), scheme);
        await page.getByTestId("risk-board").screenshot({ path: `${process.env.SHOTS}/${look.replace(/ /g, "-")}-${scheme}.png` });
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    }
  }
  await expect(page.getByTestId("risk-board")).toHaveAttribute("data-risk-look", "hc");

  // Moving a card works the same in any look.
  await page.getByRole("grid", { name: "Risk board for RC 22" }).getByRole("button", { name: /QA-203/ }).click();
  await page.getByRole("dialog").getByLabel("How much it would hurt").selectOption("2");
  await expect(page.getByRole("dialog").getByText("Moved by", { exact: false })).toBeVisible();
});

test("on a phone the Risk board is one list, riskiest first, with no sideways scroll", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, EMAIL);
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: EMAIL }, data: { riskLook: "mission" } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${KEY}/risk?release=RC%2022`);
  const list = page.getByTestId("risk-list");
  await expect(list).toBeVisible();
  await expect(page.getByRole("grid", { name: "Risk board for RC 22" })).toBeHidden();
  const groups = list.getByRole("heading");
  await expect(groups.first()).toHaveText("High risk");
  // Full names, never cut off.
  await expect(list.getByRole("button", { name: /QA-202/ })).toContainText("Invite links expire after 7 days");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  if (process.env.SHOTS) {
    for (const [, id] of LOOKS) {
      const d = new PrismaClient();
      await d.user.update({ where: { email: EMAIL }, data: { riskLook: id } });
      await d.$disconnect();
      await page.reload();
      for (const scheme of ["light", "dark"] as const) {
        await page.evaluate((s) => (document.documentElement.dataset.theme = s), scheme);
        await page.getByTestId("risk-board").screenshot({ path: `${process.env.SHOTS}/phone-${id}-${scheme}.png` });
      }
    }
    await page.screenshot({ path: `${process.env.SHOTS}/phone-page.png`, fullPage: true });
  }
  // Tap a card to move it.
  await list.getByRole("button", { name: /QA-202/ }).click();
  await expect(page.getByRole("dialog").getByLabel("How likely to break")).toBeVisible();
});
