import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { choosePlatform, openReleaseBox, pickKind } from "./projects";

// ver_89: custom run fields per umbrella (new umbrellas start with none, no OKO layout),
// the Start RC platform picker (every platform can be ticked and chooses what it runs),
// pips in a case's Execution history open their run, and every popup box has an ✕.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `NH${TAG}`;
const NAME = `Fields ${TAG}`;
let groupId = "";
let caseNumber = 0;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 1, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const c = await db.testCase.create({ data: { projectId: hub.id, number: 1, title: "Open the map" } });
    caseNumber = c.number;
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: "Smoke", cases: { create: [{ caseId: c.id, position: 0 }] } } });
    // A brand-new umbrella: no run fields and no OKO bug layout.
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [suite.id] }, { name: "Unity", suiteIds: [] }] } })).id;
  } finally {
    await db.$disconnect();
  }
});

test("run fields, the RC platform picker, pips that open runs and ✕ on popups", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // Run fields: only the built-ins until an admin adds one.
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-run-fields");
  await expect(row).toContainText("Release, Version and Environment");
  await row.getByRole("button", { name: "Change" }).click();
  await expect(row.getByText("No extra fields yet.")).toBeVisible();
  await row.getByRole("button", { name: "＋ Add a field" }).click();
  await row.getByLabel("Field name").fill("Region");
  await row.getByLabel("Type").selectOption("list");
  await row.getByLabel("Choices, comma separated").fill("EU, US");
  await row.getByLabel("Required when starting a run").check();
  await row.getByRole("button", { name: "Add field" }).click();
  await expect(row.getByRole("list", { name: "Your run fields" })).toContainText("Pick from list: EU, US");
  await expect(row.getByRole("list", { name: "Your run fields" })).toContainText("Required");

  // Start next release: Unity has no suites but can be ticked; its dropdown opens to choose.
  await page.goto(`/g/${groupId}`);
  await openReleaseBox(page);
  const box = page.getByRole("dialog");
  await box.getByLabel("Release", { exact: true }).fill("RC1");
  // ver_99: no platform is ticked for you.
  await expect(box.getByLabel("Web", { exact: true })).not.toBeChecked();
  await choosePlatform(page, "Web", "Smoke");
  await expect(box.getByRole("button", { name: "Start RC1 · 1 platform" })).toBeVisible();
  await box.getByLabel("Unity", { exact: true }).check();
  const menu = box.getByRole("group", { name: "Pick test cases for Unity" });
  await expect(menu).toContainText("Unity wasn't in the last release.");
  await expect(box.getByRole("button", { name: /Start RC1/ })).toBeDisabled();
  await menu.getByRole("checkbox", { name: "Smoke" }).check();
  await menu.getByRole("button", { name: "Done" }).click();
  await expect(box.getByRole("button", { name: "Test cases for Unity" })).toContainText("Smoke · 1 case");
  await expect(box.getByText(`${NAME} Unity RC1`)).toBeVisible();
  // ver_99: the release box asks the umbrella's run fields too, and a pick list takes a typed value.
  await expect(box.getByTestId("rc-todo")).toContainText("Fill in Region");
  await expect(box.getByRole("button", { name: "Start RC1 · 2 platforms" })).toBeDisabled();
  await box.getByLabel("Region *").fill("APAC");
  await box.getByRole("button", { name: "Start RC1 · 2 platforms" }).click();
  await expect(box).toBeHidden({ timeout: 30_000 });

  // The new umbrella's Create a run asks for Region (required), and the run shows it.
  const db = new PrismaClient();
  let webKey = "";
  try {
    const group = await db.projectGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(group.okoLayout).toBe(false);
    // Unity's suite is remembered for its next release.
    expect(JSON.stringify(group.platforms)).toContain("Unity");
    const web = await db.project.findFirstOrThrow({ where: { groupId, platform: "Web" } });
    webKey = web.key;
    // The RC's runs got the Region typed in the box.
    const rcRun = await db.testRun.findFirstOrThrow({ where: { projectId: web.id } });
    expect(JSON.stringify(rcRun.fields)).toContain("APAC");
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${webKey}/runs`);
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const start = page.getByRole("dialog");
  await pickKind(page);
  await expect(start.getByLabel("Region *")).toBeVisible();
  await expect(start.getByLabel("CSP version")).toHaveCount(0);
  await start.getByLabel("Region *").fill("EU");
  await page.keyboard.press("Escape");

  // Pips: the case's Execution history pip opens the run it came from.
  const db2 = new PrismaClient();
  try {
    const run = await db2.testRun.findFirstOrThrow({ where: { project: { key: webKey } }, include: { entries: true } });
    const e = run.entries[0];
    await db2.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: e.caseId, caseVersion: 1, status: "PASSED", stepResults: [] } });
  } finally {
    await db2.$disconnect();
  }
  await page.goto(`/p/${HUB}/cases/${caseNumber}`);
  const pip = page.getByRole("link", { name: /Smoke.*: passed.*Open the run/ });
  await expect(pip).toBeVisible();
  await pip.click();
  await expect(page).toHaveURL(new RegExp(`/p/${webKey}/runs/1/execute\\?entry=`));

  // Every popup box has an ✕ that closes it.
  await page.goto(`/g/${groupId}`);
  await openReleaseBox(page);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // A new umbrella's bug template offers Plain or Import, not the OKO layout.
  await page.goto(`/g/${groupId}/settings`);
  await expect(page.getByText(/OKO bug layout/)).toHaveCount(0);
});
