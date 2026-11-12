import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_220: bug bash bugs ready for Jira. In a test cycle whose Jira bugs use the OKO form, with a
// Jira that requires all 7 OKO fields (the mock's strict mode): Add for Jira while logging (never
// required), Flaw Patrol fills in Team, Client/SKUs, Build # and OKO Space Link, wrap-up says
// Ready for Jira or Needs N, Fill in opens the OKO form, Not a bug with a reason, Can't reproduce
// asks the finder (who answers on their screen), and only ready bugs go to Jira.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `JR${TAG}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
const AXE = require.resolve("axe-core/axe.min.js");
const RULES = ["aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "heading-order", "target-size", "color-contrast", "button-name", "nested-interactive"];
const LOOKS = ["classic", "mission", "hc", "white", "blue", "arcade", "retro"];

/** Seal like src/lib/crypto.ts, with the AUTH_SECRET the app reads from .env. */
function seal(plain: string) {
  const secret = process.env.AUTH_SECRET ?? /^AUTH_SECRET="?([^"\n]*)"?/m.exec(readFileSync(".env", "utf8"))?.[1] ?? "";
  const key = createHash("sha256").update(`secret-box:${secret}`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

async function problems(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (rules) => {
    // @ts-expect-error axe is added by the script tag
    const r = await window.axe.run(document, { runOnly: { type: "rule", values: rules } });
    return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
  }, RULES);
}

test.afterAll(async () => {
  await fetch(`${JIRA}/__oko-strict/off`).catch(() => {});
  const db = new PrismaClient();
  await db.user.update({ where: { email: "admin@example.com" }, data: { look: "classic", themeMode: "light" } }).catch(() => {});
  await db.$disconnect();
});

test("bug bash bugs get ready for Jira: Add for Jira, Ready / Needs, Fill in, Not a bug, ask the finder", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await fetch(`${JIRA}/__oko-strict/on`);
  const db = new PrismaClient();
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
  const sam = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
  const project = await db.project.create({ data: { key: KEY, name: `Jira ready ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: sam.id, role: "TESTER" }] } } });
  // The OKO bug layout, with Team "Web" as the cycle's bug default.
  await db.jiraConfig.create({ data: { projectId: project.id, siteUrl: JIRA, email: "qa-bot@example.com", tokenEncrypted: seal("secret-token"), jiraProjectKey: "OB", bugTemplate: { on: true, clientTag: "", team: "Web", clients: [], olyEnv: [], imported: null }, foundIn: { field: "versions" } } });

  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Video ${TAG}`);
  await box.getByLabel("Add an area").fill("Video player");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByTestId("bash-setup").getByLabel("Build").fill("4.21.0");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page).toHaveURL(/\/bashes\/[^/?]+/);
  const board = page.url().replace(/\?.*$/, "");
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: /Start bashing/ }).click();
  await expect(page).toHaveURL(/\/explore$/);

  // Add for Jira (3): folded, optional, in place of Add steps and details.
  await expect(page.getByRole("button", { name: "Add steps and details" })).toHaveCount(0);
  const addForJira = page.getByRole("button", { name: /Add for Jira \(3\)/ });
  await expect(addForJira).toHaveAttribute("aria-expanded", "false");
  await page.getByLabel("What did you find?").fill(`Duplicating a video breaks the player ${TAG}`);
  await addForJira.click();
  const jiraBox = page.getByTestId("bash-add-for-jira");
  await expect(jiraBox).toContainText("Optional. Leave them for later");
  await jiraBox.getByLabel("Repro steps").fill("1. Add a video\n2. Duplicate it");
  await jiraBox.getByLabel("Bug impact").fill("The copy can't play");
  await jiraBox.getByLabel("Bug workaround").fill("Add the video again");
  await page.getByRole("button", { name: "Log bug" }).click();
  const live = page.getByTestId("live-finds");
  await expect(live.locator("li").filter({ hasText: `Duplicating a video breaks the player ${TAG}` }).getByTestId("needs-tag")).toHaveText("Needs 1");

  // Logging never waits: a bug with only its one line logs too.
  await page.getByLabel("What did you find?").fill(`Turning repeat off does not stop the video ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(live.locator("li").filter({ hasText: `Turning repeat off does not stop the video ${TAG}` }).getByTestId("needs-tag")).toHaveText("Needs 4");

  // Sam's find, which will be Not a bug › Can't reproduce.
  const bash = await db.bugBash.findFirstOrThrow({ where: { name: `Video ${TAG}` } });
  const areaId = (bash.areas as { id: string }[])[0].id;
  await db.bashPerson.create({ data: { bashId: bash.id, userId: sam.id, name: "Sam Tester", areaId } });
  await db.bashItem.create({ data: { bashId: bash.id, areaId, kind: "bug", text: `Stopping playback resets the playhead ${TAG}`, byId: sam.id, byName: "Sam Tester", build: "4.21.0", platform: "Web" } });

  // Wrap up.
  await page.goto(board);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await expect(page.getByRole("columnheader", { name: "Ready for Jira?" })).toBeVisible();
  const rowOf = (text: string) => page.getByRole("row").filter({ hasText: text }).first();
  // Nobody said which client yet, so Client/SKUs is missing; the Client column fills it in.
  const ready = rowOf(`Duplicating a video breaks the player ${TAG}`);
  await expect(ready.getByTestId("needs-tag")).toContainText("Needs 1: Client/SKUs");
  for (const t of ["Duplicating a video breaks the player", "Turning repeat off does not stop the video"]) await page.getByRole("combobox", { name: `Client of ${t} ${TAG}` }).selectOption("Web");
  await expect(ready.getByTestId("needs-tag")).toHaveText("✓ Ready for Jira");

  // Not a bug › Can't reproduce on Sam's find, and ask Sam for steps.
  const samRow = rowOf(`Stopping playback resets the playhead ${TAG}`);
  await samRow.getByRole("radio", { name: "Not a bug" }).click();
  await samRow.getByRole("button", { name: "Can't reproduce" }).click();
  await expect(samRow.getByTestId("unfiled-tag")).toHaveText("Not a bug · Can't reproduce");
  const ask = samRow.getByTestId("bash-ask");
  await expect(ask.getByLabel("Ask Sam for steps")).toHaveValue("@Sam, we couldn't reproduce this. Can you add steps?");
  await ask.getByRole("button", { name: "Send to Sam" }).click();
  await expect(samRow.getByTestId("bash-ask-sent")).toContainText("Sent to Sam");

  // Sam sees it on their screen and answers.
  const samContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const samPage = await samContext.newPage();
  await signIn(samPage, "tester@example.com", "Sam Tester");
  await samPage.goto(board);
  const asked = samPage.getByTestId("bash-asked-of-you");
  await expect(asked).toContainText("@Sam, we couldn't reproduce this. Can you add steps?");
  await asked.getByLabel("Steps to see it").fill("1. Play a video\n2. Press Stop at 0:30");
  await asked.getByRole("button", { name: "Add steps" }).click();
  await expect(asked).toContainText("You added: 1. Play a video");
  await samContext.close();
  await page.reload();
  await expect(samRow.getByTestId("bash-ask-sent")).toContainText("Sam added:");

  // The header counts what's ready; only ready bugs count on the button.
  await expect(page.getByTestId("wrap-counts")).toHaveText("1 ready for Jira · 1 needs something · 1 not a bug");
  const needs = rowOf(`Turning repeat off does not stop the video ${TAG}`);
  await expect(needs.getByTestId("needs-tag")).toContainText("Needs 3: Repro steps, Bug impact, Workaround");
  await expect(needs.getByTestId("oko-filled")).toContainText("Team Web · Client/SKUs");
  await expect(needs.getByTestId("oko-filled")).toContainText("Build # 4.21.0 · OKO Space Link N/a");
  await expect(page.getByRole("button", { name: "File 1 bug to Jira and wrap up" })).toBeVisible();
  await expect(page.getByTestId("bash-not-ready")).toContainText("The one that needs something stays here");

  // Accessible in every look, and cards with no sideways scroll on a phone.
  for (const look of LOOKS) {
    await db.user.update({ where: { id: admin.id }, data: { look } });
    await page.reload();
    await expect(page.getByTestId("wrap-counts")).toBeVisible();
    expect(await problems(page), look).toEqual([]);
  }
  await db.user.update({ where: { id: admin.id }, data: { look: "classic" } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("wrap-counts")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.reload();

  // Fill in opens the same OKO form as everywhere else.
  await needs.getByRole("button", { name: "Fill in" }).click();
  const fill = page.getByTestId("bash-oko-fill");
  await expect(fill.getByRole("group", { name: "Clients needed for repro" }).or(fill.getByLabel("Repro steps"))).toHaveCount(2);
  // ver_226: the same form as a run's Report a bug. Tags say "from bash" (never "from run" or "from case"),
  // Jira Priority shows, and Found in can be picked here and goes to Jira.
  await expect(fill.getByText("from bash", { exact: true }).first()).toBeVisible();
  for (const t of ["from run", "from case", "your Actual result"]) await expect(fill.getByText(t, { exact: true })).toHaveCount(0);
  await expect(fill.getByTestId("bug-priority")).toContainText("(set in Settings → Jira)");
  await fill.getByTestId("found-in").getByLabel("Found in").selectOption("RC 22");
  await fill.getByLabel("Repro steps").fill("1. Turn repeat off\n2. Let the video end");
  await fill.getByLabel("Bug impact").fill("Videos loop forever");
  await fill.getByLabel("Bug workaround").fill("None known");
  await fill.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("bash-oko-fill")).toHaveCount(0);
  await expect(needs.getByTestId("needs-tag")).toHaveText("✓ Ready for Jira");
  await expect(page.getByTestId("wrap-counts")).toHaveText("2 ready for Jira · 1 not a bug");

  // Only ready bugs go to Jira, each with all 7 OKO fields.
  await page.getByRole("button", { name: "File 2 bugs to Jira and wrap up" }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 60_000 });
  const issues = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { summary: string; fields: Record<string, unknown> }>;
  const mine = Object.values(issues).filter((i) => i.summary.includes(TAG));
  expect(mine.map((i) => i.summary).sort()).toEqual([`[Web] - Video player - Duplicating a video breaks the player ${TAG}`, `[Web] - Video player - Turning repeat off does not stop the video ${TAG}`].sort());
  for (const i of mine) {
    expect(i.fields.customfield_11461, "Team").toEqual({ value: "Web" });
    expect(i.fields.customfield_11427, "Client/SKUs").toEqual([{ value: "Web" }]);
    expect(i.fields.customfield_11489, "Build #").toBe("4.21.0");
    expect(i.fields.customfield_11377, "OKO Space Link").toBeTruthy();
    expect(i.fields.customfield_11494, "Bug Impact").toBeTruthy();
    expect(i.fields.customfield_11513, "Bug Workaround").toBeTruthy();
    expect(i.fields.customfield_11323, "Repro Steps").toBeTruthy();
  }
  const filled = mine.find((i) => i.summary.includes("Turning repeat off"));
  // OB has Found in version only on its Edit screen, so it may arrive as a field or in words; either way it's RC 22.
  expect(JSON.stringify(filled), "Found in picked at Fill in").toContain("RC 22");
  // The report says why the other one wasn't filed.
  await expect(page.getByTestId("unfiled-tag").first()).toHaveText("Not a bug · Can't reproduce");
  // ver_226: the report's Bugs by platform table scrolls inside its card on a phone, not the page.
  await expect(page.getByTestId("bash-by-platform")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByTestId("bash-by-platform")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await db.$disconnect();
});
