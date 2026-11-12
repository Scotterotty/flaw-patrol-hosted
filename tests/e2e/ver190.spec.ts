import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_190: Export cases. Case library and test suite More menu; Excel or Google Sheets first,
// then Qase, qTest and TestRail; "The N you ticked"; Viewers can export unless an Admin turns it off.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `EX${TAG}`;
const NAME = `Export ${TAG}`;
const VIEWER = `vera.${TAG.toLowerCase()}@example.com`;
const ids = { group: "", hub: "", login: "", suite: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 4, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    ids.hub = hub.id;
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const web = await db.folder.create({ data: { projectId: hub.id, name: "Web" } });
    const login = await db.folder.create({ data: { projectId: hub.id, name: "Login", parentId: web.id } });
    ids.login = login.id;
    const shared = await db.sharedStep.create({ data: { projectId: hub.id, name: "Sign in", versions: { create: { version: 1, name: "Sign in", parameters: [], steps: [{ action: "Type the password", expected: "Signed in" }, { action: "Press Go", expected: "Home page" }] } } } });
    const mk = (number: number, title: string, folderId: string | null, steps: unknown[], extra: Record<string, unknown> = {}) =>
      db.testCase.create({ data: { projectId: hub.id, number, title, folderId, priority: "HIGH", ...extra, versions: { create: { version: 1, title, preconditions: "Signed out", priority: "HIGH", type: "MANUAL", tags: [], steps: steps as never } } } });
    const a = await mk(1, "Sign in with email", login.id, [{ kind: "step", action: "Open the sign-in page", expected: "The form shows" }, { kind: "shared", sharedStepId: shared.id, params: {} }], { jiraStories: ["APP-3"], sourceKey: "PQ-1708" });
    await mk(2, "Reset a forgotten password", login.id, [{ kind: "step", action: "Press Forgot password", expected: "An email is sent" }]);
    await mk(3, "Add to cart", web.id, [{ kind: "step", action: "Press Add", expected: "Cart shows 1" }]);
    await db.testCase.create({ data: { projectId: hub.id, number: 4, title: "Explore checkout", type: "EXPLORATORY", folderId: web.id, versions: { create: { version: 1, title: "Explore checkout", preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], steps: [] } } } });
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: "Smoke", cases: { create: [{ caseId: a.id, position: 0 }] } } });
    ids.suite = suite.id;
    await db.user.create({ data: { email: VIEWER, name: "Vera Viewer", whatsNewSeen: 999, memberships: { create: { projectId: hub.id, role: "VIEWER" } } } as never });
  } finally {
    await db.$disconnect();
  }
});

/** Download with the Export cases box open: pick which and format, press Download, return the file. */
async function download(page: Page, which: RegExp, format: RegExp) {
  const box = page.getByRole("dialog", { name: "Export cases" });
  await box.getByLabel(which).check();
  await box.getByLabel(format).check();
  const [file] = await Promise.all([page.waitForEvent("download"), box.getByRole("button", { name: "Download" }).click()]);
  await expect(box.getByRole("status")).toContainText("Downloaded");
  return { name: file.suggestedFilename(), path: (await file.path())! };
}

async function rowsOf(path: string) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(path);
  const out: string[][] = [];
  book.worksheets[0].eachRow((r) => out.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ""))));
  return out;
}

test("admin exports a folder to Qase, ticked cases to qTest, a suite to TestRail", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases?folder=${ids.login}`);
  await page.getByRole("button", { name: "Export cases" }).click();
  const box = page.getByRole("dialog", { name: "Export cases" });
  await expect(box.getByLabel("This folder (2)")).toBeChecked();
  await expect(box.getByLabel("Whole library (3)")).toBeVisible();
  // First time: Excel or Google Sheets.
  await expect(box.getByLabel(/Excel or Google Sheets/)).toBeChecked();
  const qase = await download(page, /This folder/, /^Qase/);
  expect(qase.name).toMatch(new RegExp(`^${NAME} cases - Qase - \\w{3} \\d+ \\d{4}\\.csv$`));
  const csv = await readFile(qase.path, "utf8");
  // Qase's current "Qase.io" format (ver_227): no byte order mark, v2.id first.
  expect(csv.startsWith("v2.id,title,")).toBe(true);
  expect(csv).toContain("Sign in with email");
  expect(csv).toContain("Reset a forgotten password");
  expect(csv).not.toContain("Add to cart");
  // The shared step is written out.
  expect(csv).toContain('2. ""Type the password""\n3. ""Press Go""\n');
  await box.getByRole("button", { name: "Close" }).first().click();

  // Ticking a case offers it first; the format is remembered.
  await page.goto(`/p/${HUB}/cases`);
  await page.getByRole("row", { name: /Add to cart/ }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Export cases" }).click();
  await expect(box.getByLabel("The 1 case you ticked")).toBeChecked();
  await expect(box.getByLabel(/^Qase/)).toBeChecked();
  const qtest = await download(page, /you ticked/, /^qTest/);
  const rows = await rowsOf(qtest.path);
  expect(rows[0].slice(0, 3)).toEqual(["Id", "Name", "Module"]);
  expect(rows).toHaveLength(2);
  expect(rows[1][1]).toBe("Add to cart");
  expect(rows[1][2]).toBe("Web");
  await box.getByRole("button", { name: "Close" }).first().click();

  // A test suite's More menu.
  await page.goto(`/p/${HUB}/suites/${ids.suite}`);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Export cases…" }).click();
  await expect(box.getByLabel("This suite (1)")).toBeChecked();
  const tr = await download(page, /This suite/, /^TestRail/);
  const trCsv = await readFile(tr.path, "utf8");
  expect(tr.name).toContain("Smoke cases - TestRail");
  expect(trCsv).toContain("Web > Login");
  expect(trCsv).toContain("APP-3");
  expect(trCsv).not.toContain("Reset a forgotten password");
});

test("Ctrl+K link opens the box; the whole library leaves charters out", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases?export=1`);
  const box = page.getByRole("dialog", { name: "Export cases" });
  await expect(box).toBeVisible();
  const sheet = await download(page, /Whole library/, /Excel or Google Sheets/);
  const rows = await rowsOf(sheet.path);
  expect(rows[0][0]).toBe("ID");
  const titles = rows.map((r) => r[1]);
  expect(titles).toContain("Add to cart");
  expect(titles).not.toContain("Explore checkout");
  expect(rows.find((r) => r[1] === "Sign in with email")?.[2]).toBe("Web / Login");
});

test("Viewers can export until an Admin turns it off in What can they do", async ({ page }) => {
  await signIn(page, VIEWER, "Vera Viewer");
  await page.goto(`/p/${HUB}/cases`);
  await expect(page.getByRole("button", { name: "Export cases" })).toBeVisible();
  const db = new PrismaClient();
  try {
    await db.projectGroup.update({ where: { id: ids.group }, data: { roleRules: { preset: "custom", allow: { export: ["TESTER", "LEAD"] } } } });
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  await expect(page.getByRole("heading", { name: `${NAME} case library` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export cases" })).toHaveCount(0);
  const res = await page.request.post(`/p/${HUB}/cases/export`, { data: { format: "qase", scope: "all" } });
  expect(res.status()).toBe(403);
});
