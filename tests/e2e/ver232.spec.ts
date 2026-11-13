import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_232: the Bugs page's Table and Board show the same bugs and share one filter bar. Switching
// keeps the Jira board and the filters, and the board, Found in testing and the view are saved on the
// account, so they're still there after signing out. Mock Jira project BB has boards 7 and 8.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const AXE = require.resolve("axe-core/axe.min.js");
const RULES = ["aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "link-in-text-block", "heading-order", "target-size", "color-contrast", "button-name", "nested-interactive"];

/** Seal like src/lib/crypto.ts, with the AUTH_SECRET the app reads from .env. */
function seal(plain: string) {
  const secret = process.env.AUTH_SECRET ?? /^AUTH_SECRET="?([^"\n]*)"?/m.exec(readFileSync(".env", "utf8"))?.[1] ?? "";
  const key = createHash("sha256").update(`secret-box:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** An umbrella whose Jira is mock project BB, with a Web run that found BB-3 on step 2. */
async function boardUmbrella() {
  const db = new PrismaClient();
  try {
    // ver_232: start without saved Bugs picks (view, Jira board, Found in testing).
    const admin = await db.user.update({ where: { email: "admin@example.com" }, data: { bugsPicks: {} } });
    const members = { create: [{ userId: admin.id, role: "ADMIN" as const }] };
    const hub = await db.project.create({ data: { key: `BS${TAG}`, name: `Board ${TAG}`, members } });
    const group = await db.projectGroup.create({ data: { name: `Board ${TAG}`, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }], rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    await db.jiraConfig.create({ data: { projectId: hub.id, siteUrl: JIRA, email: "qa-bot@example.com", tokenEncrypted: seal("secret-token"), jiraProjectKey: "BB" } });
    const web = await db.project.create({ data: { key: `BT${TAG}`, name: `Web ${TAG}`, platform: "Web", rcName: "RC 23", groupId: group.id, members } });
    const c = await db.testCase.create({ data: { projectId: hub.id, number: 1, title: "Materials sync" } });
    const run = await db.testRun.create({ data: { projectId: web.id, number: 1, name: "Web", build: "2.4.2", release: "RC 23" } });
    const steps = [
      { number: "1", action: "Sign in as two users in the same space.", expected: "Both see the space." },
      { number: "2", action: "Rename a material as User B.", expected: "The list updates in place." },
    ];
    const entry = await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: 0, title: c.title, priority: "MEDIUM", steps, status: "FAILED" } });
    const result = await db.testResult.create({
      data: { entryId: entry.id, runId: run.id, caseId: c.id, caseVersion: 1, status: "FAILED", stepResults: [{ status: "PASSED", actual: "" }, { status: "FAILED", actual: "The list split in two." }], testerName: "Demo Admin" },
    });
    const bug = await db.defect.create({ data: { projectId: web.id, number: 1, title: "Material list splits after another user edits", externalKey: "BB-3", externalUrl: `${JIRA}/browse/BB-3` } });
    await db.defectLink.create({ data: { defectId: bug.id, resultId: result.id, stepIndex: 1 } });
    // Written here and not in Jira yet: Table lists it, and Board shows it in "Not in Jira yet".
    await db.defect.create({ data: { projectId: web.id, number: 2, title: "Settings text overlaps on 4K", createdBy: "Demo Admin" } });
    return { groupId: group.id, runNumber: run.number, webKey: web.key, entryId: entry.id };
  } finally {
    await db.$disconnect();
  }
}

async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document, { runOnly: { type: "rule", values: rules } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, RULES);
}


test("Table and Board show the same bugs, keep the Jira board and filters, and remember them after signing out", async ({ page, context }) => {
  test.setTimeout(180_000);
  const u = await boardUmbrella();
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${u.groupId}/bugs`);
  const view = page.getByRole("group", { name: "View" });
  const bar = page.getByTestId("bugs-filter-bar");
  const showing = page.getByTestId("bugs-showing");

  // Table: Found in testing is on at first, on the Kanban board Jira has.
  await expect(view.getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("button", { name: "Found in testing" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByLabel("Jira board")).toHaveValue("7");
  await expect(showing).toContainText("Showing 2 bugs found in testing on BB board. Turn off Found in testing to see all 60.");
  await expect(page.getByText("Material list splits after another user edits")).toBeVisible();
  await expect(page.getByText("Settings text overlaps on 4K")).toBeVisible();
  await expect(page.getByTestId("jira-only")).toHaveCount(0);

  // Board: the same two bugs, with the same filter bar.
  await view.getByRole("link", { name: "Board" }).click();
  const board = page.getByTestId("bug-board");
  await expect(board.getByTestId("board-card")).toHaveText([/BB-3/]);
  await expect(board.getByTestId("board-local")).toContainText("Settings text overlaps on 4K");
  await expect(showing).toContainText("Showing 2 bugs found in testing on BB board.");

  // Pick the other Jira board: switching to Table and back keeps it.
  await bar.getByLabel("Jira board").selectOption("8");
  await expect(page).toHaveURL(/board=8/);
  await expect(board.getByTestId("board-column").locator("h2")).toHaveText([/^Blocked \/ NMI/, /^Needs QA/]);
  await view.getByRole("link", { name: "Table" }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page).toHaveURL(/board=8/);
  await expect(bar.getByLabel("Jira board")).toHaveValue("8");
  await view.getByRole("link", { name: "Board" }).click();
  await expect(board).toBeVisible();
  await expect(bar.getByLabel("Jira board")).toHaveValue("8");

  // Every bug on the board, then a search: Table shows the same one, and its bug panel.
  await bar.getByRole("button", { name: "Found in testing" }).click();
  await expect(bar.getByRole("button", { name: "Found in testing" })).toHaveAttribute("aria-pressed", "false");
  await expect(board).toBeVisible();
  await bar.getByLabel("Search bugs").fill("typing indicator");
  await expect(board.getByTestId("board-card")).toHaveText([/BB-4/]);
  await expect(page).toHaveURL(/q=typing/);
  await view.getByRole("link", { name: "Table" }).click();
  await expect(bar.getByLabel("Search bugs")).toHaveValue("typing indicator");
  await expect(bar.getByRole("button", { name: "Found in testing" })).toHaveAttribute("aria-pressed", "false");
  const only = page.getByTestId("jira-only");
  await expect(only.getByTestId("jira-only-row")).toHaveText([/BB-4.*Typing indicator shows for the wrong user/]);
  await expect(page.getByText("Material list splits after another user edits")).toHaveCount(0);
  await expect(showing).toContainText("Showing 1 bug from BB triage, found in testing or not.");
  await only.getByTestId("jira-only-row").click();
  await expect(page.getByTestId("bug-panel").getByRole("heading", { name: "Typing indicator shows for the wrong user" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Lighthouse's checks on Table with Jira's bugs, light and dark.
  const db = new PrismaClient();
  try {
    for (const [mode, look] of [["light", "classic"], ["dark", "classic"], ["dark", "mission"], ["light", "hc"]]) {
      await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: mode, look } });
      await page.goto(`/g/${u.groupId}/bugs?view=table&found=all`);
      await expect(page.getByTestId("jira-only")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await problems(page), `${mode} ${look}`).toEqual([]);
    }
  } finally {
    await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: "light", look: "classic" } });
    await db.$disconnect();
  }

  // Back to Board, then sign out and back in (no cookies left): Board, BB triage and every bug, from the account.
  await page.goto(`/g/${u.groupId}/bugs?view=board`);
  await expect(page.getByTestId("bug-board")).toBeVisible();
  await context.clearCookies();
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${u.groupId}/bugs`);
  await expect(page.getByTestId("bug-board")).toBeVisible();
  await expect(bar.getByLabel("Jira board")).toHaveValue("8");
  await expect(bar.getByRole("button", { name: "Found in testing" })).toHaveAttribute("aria-pressed", "false");

  // Phones: the filter bar wraps, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/g/${u.groupId}/bugs?view=table`);
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const reset = new PrismaClient();
  await reset.user.update({ where: { email: "admin@example.com" }, data: { bugsPicks: {} } }).finally(() => reset.$disconnect());
});
