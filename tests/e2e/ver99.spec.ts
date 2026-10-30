import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { choosePlatform, openReleaseBox, pickKind } from "./projects";

// ver_99: nothing is picked for you. Start a run and Release candidate open blank, with last
// time's choices as "Use …" suggestions and a still-needed list; New test suite has numbered
// steps, a folder list with Tick all and "Can't find a case?"; pick lists take typed values;
// + New platform wherever a platform is picked.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `NP${TAG}`;
const NAME = `Blank ${TAG}`;
let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 99 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 5, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const personas = await db.folder.create({ data: { projectId: hub.id, name: "Test Personas" } });
    const unity = await db.folder.create({ data: { projectId: hub.id, name: "UNITY", parentId: personas.id } });
    const web = await db.folder.create({ data: { projectId: hub.id, name: "WEB", parentId: personas.id } });
    const make = (n: number, title: string, folderId: string | null, archived = false) =>
      db.testCase.create({ data: { projectId: hub.id, number: n, title, folderId, archived, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: "Do it", expected: "It works" }] } } } });
    const cases = [await make(1, "[UNITY] Spaces deep link", unity.id), await make(2, "[UNITY] Hub space list", unity.id), await make(3, "[WEB] Share a link", web.id)];
    await make(4, "Old login", null, true);
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: "Smoke", cases: { create: cases.map((c, i) => ({ caseId: c.id, position: i })) } } });
    groupId = (
      await db.projectGroup.create({
        data: {
          name: NAME,
          hubProjectId: hub.id,
          platforms: [{ name: "Web", suiteIds: [suite.id] }],
          runKinds: [{ id: "smoke", name: "Smoke test", suiteId: suite.id }],
          runFields: [{ id: "csp", name: "CSP version", type: "list", choices: ["5.2", "5.3"], required: true, rc: true, jira: true }],
        },
      })
    ).id;
    const cycle = await db.project.create({ data: { key: `NC${TAG}`, name: `Demo RC 1 ${TAG}`, groupId, platform: "Web", rcName: "Demo RC 1", runSeq: 0, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    void cycle;
  } finally {
    await db.$disconnect();
  }
});

test("Start a run opens blank: Use it, Use the release, a typed CSP version and + New platform", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}`);
  await page.getByRole("button", { name: /Start a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  const todo = box.getByTestId("run-todo");
  await expect(todo).toContainText("Pick what to run");
  await expect(todo).toContainText("Tick a test cycle");
  await expect(todo).toContainText("Fill in CSP version");
  // The kind's usual suite is offered, not picked; no test cycle is ticked.
  for (const name of [/Whole Case library/, /A suite/, /Pick cases/]) await expect(box.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  await expect(box.getByRole("checkbox", { name: `Demo RC 1 ${TAG}` })).not.toBeChecked();
  await box.getByTestId("usual-suite").getByRole("button", { name: "Use it" }).click();
  await expect(box.getByRole("radio", { name: /Smoke/ })).toBeChecked();
  await expect(todo).toContainText("3 cases");

  // Pick cases: the folder list beside the cases, Tick all, and Can't find a case?
  await box.getByRole("button", { name: /Pick cases/ }).click();
  const folders = box.getByTestId("folder-list");
  await expect(folders.getByRole("button", { name: /^All cases\s*3$/ })).toBeVisible();
  await folders.getByRole("button", { name: /^UNITY\s*2$/ }).click();
  await box.getByRole("button", { name: "Tick all 2" }).click();
  await expect(box.getByText("2 picked")).toBeVisible();
  await box.getByText("Can't find a case?").click();
  await expect(box.getByTestId("cant-find")).toContainText("1 archived case is hidden");
  await expect(box.getByTestId("cant-find")).toContainText("[UNITY] or [WEB]");

  // The release is offered from the ticked test cycle; the name is gray until typed.
  await box.getByRole("checkbox", { name: `Demo RC 1 ${TAG}` }).check();
  await expect(todo).toContainText(`Goes in Demo RC 1 ${TAG}`);
  await expect(box.getByLabel("Release", { exact: true })).toHaveValue("");
  await box.getByTestId("release-suggest").getByRole("button", { name: "Use Demo RC 1" }).click();
  await expect(box.getByLabel("Release", { exact: true })).toHaveValue("Demo RC 1");
  await expect(box.getByLabel("Run name (optional)")).toHaveValue("");
  await expect(box.getByLabel("Run name (optional)")).toHaveAttribute("placeholder", /^Smoke test /);
  // A pick list takes a typed value.
  await expect(box.getByRole("button", { name: "Start and test now" })).toBeDisabled();
  await box.getByLabel("CSP version *").fill("5.4");
  await expect(box.getByRole("button", { name: "Start and test now" })).toBeEnabled();

  // + New platform in + New test cycle.
  await box.getByRole("button", { name: "＋ New test cycle" }).click();
  const made = box.getByTestId("new-cycle");
  await made.getByRole("button", { name: "＋ New platform" }).click();
  await expect(made).toContainText(`Added to ${NAME}'s platforms`);
  await made.getByLabel("New platform name").fill("Android");
  await made.getByRole("button", { name: "Add platform" }).click();
  await expect(made.getByRole("radio", { name: /Android/ })).toHaveAttribute("aria-checked", "true");
  await made.getByLabel("Name", { exact: true }).fill(`Sprint 1 ${TAG}`);
  await expect(todo).toContainText(`One run in each: Demo RC 1 ${TAG}, Sprint 1 ${TAG} (new)`);
  await box.getByRole("button", { name: "Start 2 runs" }).click();
  await expect(page).toHaveURL(/\/runs$/, { timeout: 60_000 });

  const db = new PrismaClient();
  try {
    const run = await db.testRun.findFirstOrThrow({ where: { project: { key: `NC${TAG}` } } });
    expect(run.cspVersion).toBe("5.4");
    expect(run.release).toBe("Demo RC 1");
    expect(run.name).toMatch(/^Smoke test /);
    const sprint = await db.project.findFirstOrThrow({ where: { groupId, name: `Sprint 1 ${TAG}` } });
    expect(sprint.platform).toBe("Android");
    const group = await db.projectGroup.findUniqueOrThrow({ where: { id: groupId } });
    expect(JSON.stringify(group.platforms)).toContain("Android");
  } finally {
    await db.$disconnect();
  }
});

test("Release candidate opens blank: Use the next name, nothing ticked or carried over", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}`);
  await openReleaseBox(page);
  const rc = page.getByRole("dialog");
  const todo = rc.getByTestId("rc-todo");
  await expect(rc.getByLabel("Release", { exact: true })).toHaveValue("");
  await expect(todo).toContainText("Name the release");
  await expect(todo).toContainText("Tick a platform");
  for (const p of ["Web", "Android"]) await expect(rc.getByRole("checkbox", { name: p, exact: true })).not.toBeChecked();
  await rc.getByTestId("rc-suggest").getByRole("button", { name: "Use Demo RC 2" }).click();
  await expect(rc.getByLabel("Release", { exact: true })).toHaveValue("Demo RC 2");
  await choosePlatform(page, "Web", /suites again/);
  await expect(todo).toContainText("Fill in CSP version");
  await rc.getByLabel("CSP version *").fill("5.3");
  await rc.getByRole("button", { name: "Start Demo RC 2 · 1 platform" }).click();
  await expect(rc).toBeHidden({ timeout: 30_000 });
  const db = new PrismaClient();
  try {
    const cycle = await db.project.findFirstOrThrow({ where: { groupId, rcName: "Demo RC 2" } });
    const run = await db.testRun.findFirstOrThrow({ where: { projectId: cycle.id } });
    expect(run.cspVersion).toBe("5.3");
  } finally {
    await db.$disconnect();
  }
});

test("New test suite: numbered steps, folder list, Tick all, still needed and Can't find a case?", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/suites/new`);
  await expect(page.getByText("1. Name", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /2\. Add cases/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /3\. In this suite \(0\)/ })).toBeVisible();
  await expect(page.getByTestId("suite-todo")).toHaveText("Still needed: Name the suite, add at least one case");
  await expect(page.getByRole("button", { name: "Create suite" })).toBeDisabled();
  await expect(page.getByTestId("bracket-hint")).toContainText("[UNITY] or [WEB]");
  await page.getByTestId("folder-list").getByRole("button", { name: /^WEB\s*1$/ }).click();
  await page.getByRole("button", { name: "Tick all 1" }).click();
  await expect(page.getByRole("heading", { name: /3\. In this suite \(1\)/ })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(`Web only ${TAG}`);
  await expect(page.getByTestId("suite-todo")).toHaveCount(0);
  await page.getByText("Can't find a case?").click();
  await expect(page.getByTestId("cant-find")).toContainText(`Only ${NAME}'s Case library shows here`);
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByRole("heading", { name: `Web only ${TAG}` })).toBeVisible();
});
