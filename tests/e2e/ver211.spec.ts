import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_211: the Bugs page's Board view. Every bug on the Jira board (mock project BB) in the
// board's columns, filters, Show more, the bug panel (description, where the bug was found,
// comments, attachments, details), the remembered pick, phones, and Lighthouse's checks.

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
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const members = { create: [{ userId: admin.id, role: "ADMIN" as const }] };
    const hub = await db.project.create({ data: { key: `BB${TAG}`, name: `Board ${TAG}`, members } });
    const group = await db.projectGroup.create({ data: { name: `Board ${TAG}`, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }], rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    await db.jiraConfig.create({ data: { projectId: hub.id, siteUrl: JIRA, email: "qa-bot@example.com", tokenEncrypted: seal("secret-token"), jiraProjectKey: "BB" } });
    const web = await db.project.create({ data: { key: `BW${TAG}`, name: `Web ${TAG}`, platform: "Web", rcName: "RC 23", groupId: group.id, members } });
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

test("Board shows every bug on the Jira board, and the bug panel shows the ticket and where it was found", async ({ page }) => {
  test.setTimeout(180_000);
  const u = await boardUmbrella();
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${u.groupId}/bugs`);
  // Table first, with the switch next to the title.
  await expect(page.getByRole("group", { name: "View" }).getByRole("link", { name: "Table" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("group", { name: "View" }).getByRole("link", { name: "Board" }).click();
  await expect(page).toHaveURL(/view=board/);
  const board = page.getByTestId("bug-board");
  await expect(board).toBeVisible();

  // The board's columns, without the Done one.
  const columns = board.getByTestId("board-column");
  await expect(columns.locator("h2")).toHaveText([/^New/, /^Open \/ Reopen/, /^Blocked \/ NMI/, /^Needs QA/, /^In test/]);
  const newCol = board.getByRole("region", { name: "New" });
  await expect(newCol.getByTestId("board-card")).toHaveCount(50);
  await newCol.getByRole("button", { name: "Show 6 more" }).click();
  await expect(newCol.getByTestId("board-card")).toHaveCount(56);
  await expect(board.getByRole("region", { name: "In test" }).getByText("Nothing here")).toBeVisible();
  await expect(board.getByText("Old crash on exit")).toHaveCount(0);

  // BB-3: found in testing, assigned to me, in Needs QA.
  const qa = board.getByRole("region", { name: "Needs QA" });
  const card = qa.getByTestId("board-card").filter({ hasText: "BB-3" });
  await expect(card.getByText("Found in testing")).toBeVisible();
  await expect(card.getByText("You", { exact: true })).toBeVisible();
  await expect(board.getByRole("region", { name: "Open / Reopen" }).getByText("Jordan", { exact: true })).toBeVisible();

  // Filters.
  await board.getByRole("button", { name: "Found in testing", exact: true }).click();
  await expect(board.getByTestId("board-card")).toHaveCount(1);
  await board.getByRole("button", { name: "Clear filters", exact: true }).click();
  await board.getByRole("button", { name: "Mine", exact: true }).click();
  await expect(board.getByTestId("board-card")).toHaveText([/BB-3/]);
  await board.getByRole("button", { name: "Clear filters", exact: true }).click();
  await board.getByLabel("Search bugs").fill("typing indicator");
  await expect(board.getByTestId("board-card")).toHaveText([/BB-4/]);
  await board.getByLabel("Search bugs").fill("");
  await board.getByLabel("Label").selectOption("UE_Materials");
  await expect(board.getByTestId("board-card")).toHaveCount(2);
  await board.getByLabel("Label").selectOption("");

  // The bug panel.
  await card.click();
  const panel = page.getByTestId("bug-panel");
  await expect(panel.getByRole("heading", { name: "Material list splits after another user edits" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open in Jira ↗" })).toHaveAttribute("href", `${JIRA}/browse/BB-3`);
  await expect(panel.getByTestId("bug-panel-description")).toContainText("Steps to reproduce");
  await expect(panel.getByTestId("bug-panel-description")).toContainText("User B renames any material.");
  // ver_212: the team's own Repro Steps field, right under the description.
  const repro = panel.getByTestId("bug-panel-repro");
  await expect(repro.getByRole("heading", { name: "Repro steps (from Jira)" })).toBeVisible();
  // ver_231: steps typed on one line in Jira show one per line.
  await expect(repro.getByTestId("jira-steps")).toBeVisible();
  await expect(repro.locator("li")).toHaveText(["Sign in as two users in the same space.", "As User B, rename any material.", "Look at User A's material list."]);
  const found = panel.getByTestId("bug-panel-found");
  await expect(found).toContainText("Where the bug was found");
  await expect(found).toContainText("Materials sync");
  await expect(found.getByTestId("found-step")).toContainText("Rename a material as User B.");
  await expect(found.getByTestId("found-step")).toContainText("Bug found here.");
  await expect(found.getByTestId("found-step")).toContainText("Actual: The list split in two.");
  await expect(found.getByRole("link", { name: "Open this case" })).toHaveAttribute("href", `/p/${u.webKey}/runs/${u.runNumber}/execute?entry=${u.entryId}`);
  // Comments, Attachments and Details stay closed until opened. Comments are newest first.
  const comments = panel.getByTestId("bug-panel-comments");
  await expect(comments.getByText("Fixed in build 4.21")).toBeHidden();
  await comments.locator("summary").click();
  await expect(comments.locator("p.text-xs").first()).toContainText("Sam Rivera");
  const files = panel.getByTestId("bug-panel-attachments");
  await files.locator("summary").click();
  const shot = files.getByRole("link", { name: "split-list.png" });
  const res = await page.request.get((await shot.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const details = panel.getByTestId("bug-panel-details");
  await details.locator("summary").click();
  await expect(details).toContainText("Fix version");
  await expect(details).toContainText("2.4.3");
  // The team's other filled-in fields; empty ones and Jira's own bookkeeping stay out.
  await expect(details).toContainText("Build #");
  await expect(details).toContainText("4.20.1");
  await expect(details).toContainText("Repro Rate");
  await expect(details).not.toContainText("Bug Impact");
  await expect(details).not.toContainText("Rank");
  // A bug no run found has no "Where the bug was found".
  await board.getByRole("region", { name: "Blocked / NMI" }).getByTestId("board-card").first().click();
  await expect(panel.getByTestId("bug-panel-description")).toBeVisible();
  await expect(panel.getByTestId("bug-panel-found")).toHaveCount(0);
  await expect(panel.getByTestId("bug-panel-repro")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Someone outside the umbrella can't read its Jira files.
  const outsider = await page.request.get(`/api/bug-board/file?g=nope&id=7001`);
  expect(outsider.status()).toBe(404);

  // The pick is remembered: Bugs opens on the board next time.
  await page.goto(`/g/${u.groupId}/bugs`);
  await expect(page.getByTestId("bug-board")).toBeVisible();

  // Lighthouse's checks, with the panel open, in light, dark and the looks.
  const db = new PrismaClient();
  try {
    for (const [mode, look] of [["light", "classic"], ["dark", "classic"], ["light", "hc"], ["dark", "mission"], ["dark", "retro"], ["light", "white"], ["light", "blue"], ["dark", "arcade"]]) {
      await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: mode, look } });
      await page.goto(`/g/${u.groupId}/bugs?view=board`);
      await page.getByRole("region", { name: "Needs QA" }).getByTestId("board-card").first().click();
      await expect(page.getByTestId("bug-panel-found")).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(await problems(page), `${mode} ${look}`).toEqual([]);
    }
  } finally {
    await db.user.update({ where: { email: "admin@example.com" }, data: { themeMode: "light", look: "classic" } });
    await db.$disconnect();
  }

  // Phones: one column at a time, picked by name; the panel opens full screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/g/${u.groupId}/bugs?view=board`);
  const tabs = page.getByRole("group", { name: "Board columns" });
  await expect(page.getByRole("region", { name: "New" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Needs QA" })).toBeHidden();
  await tabs.getByRole("button", { name: /Needs QA/ }).click();
  await expect(page.getByRole("region", { name: "New" })).toBeHidden();
  await page.getByRole("region", { name: "Needs QA" }).getByTestId("board-card").click();
  await expect(page.getByTestId("bug-panel")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId("bug-panel").getByRole("button", { name: "Close" }).click();
  await page.goto(`/g/${u.groupId}/bugs?view=table`);
});
