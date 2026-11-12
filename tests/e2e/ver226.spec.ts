import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_226 (audit Nov 11 2026): readable in every look. A run's Test button on phones, the count next
// to the left menu's current page, the top-left logo's name on phones, and Jira Priority in Write a bug.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `RD${TAG}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const AXE = require.resolve("axe-core/axe.min.js");

async function problems(page: Page, rules: string[]) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (values) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document, { runOnly: { type: "rule", values } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, rules);
}

test.afterAll(async () => {
  const db = new PrismaClient();
  await db.user.update({ where: { email: "admin@example.com" }, data: { look: "classic", themeMode: "light" } }).catch(() => {});
  await db.$disconnect();
});

test("a run's Test button, the menu count and the logo read well in every look, desktop and phone", async ({ page }) => {
  test.setTimeout(300_000);
  const db = new PrismaClient();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  await db.project.create({ data: { key: KEY, name: `Readable ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Open the cart");
  await page.getByLabel("Step 1 action").fill("Tap Cart");
  await page.getByLabel("Step 1 expected result").fill("The cart opens");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Open the cart" })).toBeVisible();
  await page.goto(`/p/${KEY}/cases`);
  await page.getByRole("checkbox", { name: "Select all" }).check();
  await page.getByRole("button", { name: /^Run \d+ selected$/ }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));

  for (const look of ["classic", "mission", "hc", "white", "blue", "arcade", "retro"]) {
    await db.user.update({ where: { id: admin.id }, data: { look } });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 860 });
      await page.goto(`/p/${KEY}/runs/1`);
      // One Test link shows at each width: a text link on desktop, a button on phones.
      const go = page.getByRole("row").filter({ hasText: "Open the cart" }).getByRole("link", { name: "Test", exact: true });
      await expect(go).toHaveCount(1);
      expect(await problems(page, ["color-contrast", "link-name", "target-size"]), `${look} ${width}`).toEqual([]);
    }
  }
  // The logo is named "Flaw Patrol" on phones too.
  await expect(page.getByRole("link", { name: "Flaw Patrol" }).first()).toBeVisible();
  // The phone button opens the case.
  await page.getByRole("row").filter({ hasText: "Open the cart" }).getByRole("link", { name: "Test", exact: true }).click();
  await expect(page).toHaveURL(/\/execute\?entry=/);
  await db.$disconnect();
});

test("Write a bug shows Jira Priority when the bug goes to Jira, like a run's Report a bug", async ({ page }) => {
  const db = new PrismaClient();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const key = `WP${TAG}`;
  await db.project.create({ data: { key, name: `Priority ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${key}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
  const p = await db.project.findUniqueOrThrow({ where: { key } });
  await db.jiraConfig.update({ where: { projectId: p.id }, data: { sharedTemplateId: "shared_oko_layout", bugTemplate: { on: true, clientTag: "WEB", team: "Web", clients: [], olyEnv: [], imported: null } } });
  await page.goto(`/p/${key}/bugs?write=1`);
  const form = page.getByRole("dialog", { name: "Write a bug" }).getByTestId("bug-template");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("bug-priority")).toContainText("(set in Settings → Jira)");
  await db.$disconnect();
});
