import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { openReleaseBox } from "./projects";

// ver_91 (director fixes): Start next release picks cases from folders and carries testers
// over per case; CI uploads with a token; one Export menu on Reports (PDF, Excel);
// Send to Jira for bugs saved before Jira, with severity names read from Jira; imports
// keep the file's folders and TestRail Type values; the role summary matches the grid.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `DF${TAG}`;
const NAME = `Director ${TAG}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
let groupId = "";
let prevKey = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    const hub = await db.project.create({
      data: { key: HUB, name: NAME, caseSeq: 3, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: tester.id, role: "TESTER" }] } },
    });
    const checkout = await db.folder.create({ data: { projectId: hub.id, name: "Checkout" } });
    const login = await db.folder.create({ data: { projectId: hub.id, name: "Login" } });
    const cases = await Promise.all(
      [
        { number: 1, title: `Pay by card ${TAG}`, folderId: checkout.id },
        { number: 2, title: `Apply coupon ${TAG}`, folderId: checkout.id },
        { number: 3, title: `Sign in works ${TAG}`, folderId: login.id },
      ].map((c) => db.testCase.create({ data: { projectId: hub.id, ...c } })),
    );
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    // Last release: Web ran cases 1 and 2 by picking cases, and Sam Tester had both.
    prevKey = `${HUB}W1`;
    const prev = await db.project.create({
      data: {
        key: prevKey,
        name: `${NAME} Web RC1`,
        groupId,
        platform: "Web",
        rcName: "RC1",
        runSeq: 1,
        members: { create: [{ userId: admin.id, role: "ADMIN", fromUmbrella: true }, { userId: tester.id, role: "TESTER", fromUmbrella: true }] },
      },
    });
    const run = await db.testRun.create({ data: { projectId: prev.id, number: 1, name: "Web RC1", release: "RC1", state: "ACTIVE" } });
    for (const [i, c] of cases.slice(0, 2).entries())
      await db.runEntry.create({ data: { runId: run.id, caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: c.priority, steps: [], assigneeId: tester.id } });
  } finally {
    await db.$disconnect();
  }
});

test("Start next release: Choose from folders, Same N cases, and who gets what", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}`);
  await openReleaseBox(page);
  const box = page.getByRole("dialog");
  await box.getByLabel("Release", { exact: true }).fill("RC2");
  // ver_99: nothing ticked; ticking Web opens its dropdown with last release's cases offered.
  await box.getByRole("checkbox", { name: "Web", exact: true }).check();
  const menu = box.getByRole("group", { name: "Pick test cases for Web" });
  await menu.getByRole("button", { name: /Same 2 cases as RC1/ }).click();
  await box.getByRole("button", { name: "Test cases for Web" }).click();
  await menu.getByRole("button", { name: /Choose from folders/ }).click();
  const picker = box.getByRole("group", { name: "Choose Web's cases" });
  await expect(picker.getByText("2 cases picked.")).toBeVisible();
  await picker.getByLabel("All of Login").check();
  await expect(picker.getByText("3 cases picked.")).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();

  // Carry-over names each tester's cases for this platform, once it's ticked (ver_99).
  await box.getByRole("checkbox", { name: /Same testers on the same cases/ }).check();
  await box.getByRole("button", { name: "See who gets what" }).click();
  await expect(box.getByTestId("who-gets-what")).toContainText(`Sam Tester: ${HUB}-1, ${HUB}-2`);
  await expect(box.getByTestId("who-gets-what")).toContainText("Unassigned: 1 case");
  await box.getByRole("button", { name: /Start RC2/ }).click();
  await expect(box).toBeHidden({ timeout: 30_000 });

  const db = new PrismaClient();
  try {
    const cycle = await db.project.findFirstOrThrow({ where: { groupId, rcName: "RC2" } });
    const run = await db.testRun.findFirstOrThrow({ where: { projectId: cycle.id }, include: { entries: { orderBy: { position: "asc" } } } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    expect(run.name).toBe("Web RC2");
    expect(run.entries).toHaveLength(3);
    expect(run.entries.map((e) => e.assigneeId)).toEqual([tester.id, tester.id, null]);
  } finally {
    await db.$disconnect();
  }
});

test("CI uploads: a token posts JUnit results into the newest Web test cycle", async ({ page, request }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/settings#ci-uploads`);
  const row = page.locator("#row-ci-uploads");
  // The #ci-uploads link opens the row by itself.
  await row.getByLabel("Token name").fill("GitHub Actions");
  await row.getByRole("button", { name: "+ New token" }).click();
  const token = (await row.getByTestId("ci-new-token").textContent())!.trim();
  expect(token).toMatch(/^fp_ci_/);
  await expect(row.getByText("Copy this token now.")).toBeVisible();
  await expect(row.getByRole("button", { name: "Copy GitHub Actions step" })).toBeVisible();

  const bad = await request.post("/api/ci/results", { headers: { Authorization: "Bearer fp_ci_nope" }, multipart: { platform: "Web" } });
  expect(bad.status()).toBe(401);

  const xml = `<?xml version="1.0"?><testsuite name="web" tests="2"><testcase classname="login" name="Sign in works ${TAG}" time="1"/><testcase classname="login" name="Sign out ${TAG}" time="1"><failure message="Still signed in"/></testcase></testsuite>`;
  const res = await request.post("/api/ci/results", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { platform: "web", build: "77", file: { name: "junit.xml", mimeType: "application/xml", buffer: Buffer.from(xml) } },
  });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  const db = new PrismaClient();
  try {
    const cycle = await db.project.findFirstOrThrow({ where: { groupId, rcName: "RC2" } });
    expect(body.cycle).toBe(cycle.key);
    const run = await db.testRun.findFirstOrThrow({ where: { projectId: cycle.id, number: body.run }, include: { entries: true } });
    expect(run.automated).toBe(true);
    expect(run.build).toBe("77");
    expect(run.createdBy).toBe("CI (GitHub Actions)");
    // The same-title test joined case 3 instead of making a twin; the other made a new case.
    const hubCases = await db.testCase.findMany({ where: { project: { key: HUB } }, orderBy: { number: "asc" } });
    expect(hubCases.filter((c) => c.title === `Sign in works ${TAG}`)).toHaveLength(1);
    expect(run.entries.map((e) => e.caseId)).toContain(hubCases[2].id);
    const t = await db.ciToken.findFirstOrThrow({ where: { groupId } });
    expect(t.lastUsedAt).not.toBeNull();
    expect(t.hash).toBe(createHash("sha256").update(token).digest("hex"));
  } finally {
    await db.$disconnect();
  }
  // The same file again is refused as a duplicate.
  const again = await request.post("/api/ci/results", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { platform: "Web", file: { name: "junit.xml", mimeType: "application/xml", buffer: Buffer.from(xml) } },
  });
  expect(again.status()).toBe(409);
  // A random token of the right shape is refused too.
  const forged = await request.post("/api/ci/results", { headers: { Authorization: `Bearer fp_ci_${randomBytes(30).toString("base64url")}` }, multipart: { platform: "Web" } });
  expect(forged.status()).toBe(401);
});

test("Export menu on umbrella Reports: PDF and Excel", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/reports`);
  await page.getByRole("button", { name: "Export" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /^CSV/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Copy for Confluence/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Excel workbook/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /PDF report/ }).click();
  const dialog = page.getByRole("dialog", { name: "Export PDF report" });
  const href = await dialog.getByRole("link", { name: "Download PDF" }).getAttribute("href");
  const pdf = await page.request.get(href!, { timeout: 120_000 });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const xlsx = await page.request.get(`/g/${groupId}/reports/export?format=xlsx&tabs=status,testers`, { timeout: 120_000 });
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
  // Testers are A to Z, not a ranking.
  await page.keyboard.press("Escape");
  await page.goto(`/g/${groupId}/reports?view=testers`);
  await expect(page.getByText("A to Z, not ranked")).toBeVisible();
});

test("Send to Jira for a bug saved before Jira, with Jira's severity names", async ({ page }) => {
  test.setTimeout(240_000);
  // A bug saved in last release's run before Jira was connected.
  const db = new PrismaClient();
  try {
    const prev = await db.project.findUniqueOrThrow({ where: { key: prevKey } });
    const run = await db.testRun.findFirstOrThrow({ where: { projectId: prev.id }, include: { entries: { orderBy: { position: "asc" } } } });
    const e = run.entries[0];
    const result = await db.testResult.create({ data: { entryId: e.id, runId: run.id, caseId: e.caseId, caseVersion: 1, status: "FAILED", stepResults: [], comment: "Card declined" } });
    const d = await db.defect.create({ data: { projectId: prev.id, number: 1, title: `Card declined ${TAG}`, severity: "MINOR" } });
    await db.defectLink.create({ data: { defectId: d.id, resultId: result.id, stepIndex: null } });
    await db.project.update({ where: { id: prev.id }, data: { defectSeq: 1 } });
  } finally {
    await db.$disconnect();
  }
  await signIn(page, "admin@example.com", "Demo Admin");
  // Before Jira: plain severity names.
  await page.goto(`/p/${prevKey}/bugs`);
  await expect(page.getByRole("row").filter({ hasText: `Card declined ${TAG}` })).toContainText("Minor");

  // Connect the mock Jira on the umbrella; its Severity field is found by itself.
  await page.goto(`/g/${groupId}/settings#jira`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
  await expect(page.getByTestId("jira-severity")).toContainText("Severity");

  await page.goto(`/p/${prevKey}/bugs`);
  await expect(page.getByTestId("not-in-jira")).toContainText("1 bug");
  const row = page.getByRole("row").filter({ hasText: `Card declined ${TAG}` });
  await expect(row).toContainText("Saved before Jira was connected");
  await row.getByRole("button", { name: "Send to Jira" }).click();
  const dialog = page.getByRole("dialog", { name: "Send D-1 to Jira" });
  await expect(dialog.getByLabel("Severity")).toContainText("D - Minor");
  await dialog.getByRole("button", { name: "File bug in Jira" }).click();
  // The bug now is that Jira issue, so its row shows the key and no Send button.
  await expect(row).toContainText(/QA-\d+/);
  await expect(page.getByTestId("not-in-jira")).toHaveCount(0);
  const db2 = new PrismaClient();
  try {
    const bugs = await db2.defect.findMany({ where: { project: { key: prevKey } } });
    // The same bug became the Jira issue: no second bug.
    expect(bugs).toHaveLength(1);
    expect(bugs[0].externalKey).toMatch(/^QA-\d+$/);
  } finally {
    await db2.$disconnect();
  }
});

test("Import keeps the file's folders and TestRail Type values; roles summary matches the grid", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/import`);
  const csv = ["Title,Section,Type,Steps,Expected Result", `Search works ${TAG},Store / Search,Functional,Search shoes,Shoes shown`, `Empty search ${TAG},Store / Search,Negative,Search nothing,Hint shown`].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "testrail.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByLabel("Use the file's folders")).toBeChecked();
  await expect(page.getByTestId("type-tags-note")).toContainText("Functional, Negative");

  await page.goto(`/g/${groupId}/settings#roles`);
  await expect(page.getByTestId("role-summary")).toContainText("Everyone can use every feature. Only admins archive, delete, change members and roles");
});
