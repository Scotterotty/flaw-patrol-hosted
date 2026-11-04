import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { choosePlatform, openReleaseBox, pickKind } from "./projects";

// ver_85 (full test findings #6, #7, #27, A1): Create a run ticks the test cycle you're in,
// handing a run to someone else lands on the run page with a link for them,
// Start next release can close the last release's open runs, and Largest text stacks the runner.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Hand ${TAG}`;
const HUB = `H${TAG}`;

test("start a run in the test cycle you're in, hand it off, close it with the next release, and read it at Largest text", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(NAME);
  await make.getByLabel("Key").fill(HUB);
  await make.getByLabel("Release", { exact: true }).fill("RC4");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: "＋ Add a platform" }).click();
  await make.getByLabel("Platform 2").fill("Unity");
  await make.getByRole("button", { name: `Make ${NAME} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();

  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByLabel("Title").fill(`Log in ${TAG}`);
  await page.getByLabel("Step 1 action").fill("Open the app");
  await page.getByLabel("Step 1 expected result").fill("The sign-in page shows");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: `Log in ${TAG}` })).toBeVisible();

  // Dana (a lead) is on the team, and Web runs a suite with that case.
  const db = new PrismaClient();
  let web = "";
  try {
    const group = await db.projectGroup.findFirstOrThrow({ where: { name: NAME }, include: { projects: true } });
    const dana = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    for (const p of group.projects) await db.projectMember.upsert({ where: { projectId_userId: { projectId: p.id, userId: dana.id } }, create: { projectId: p.id, userId: dana.id, role: "LEAD" }, update: {} });
    web = group.projects.find((p) => p.platform === "Web")!.key;
    const hub = await db.project.findUniqueOrThrow({ where: { key: HUB } });
    const c = await db.testCase.findFirstOrThrow({ where: { projectId: hub.id } });
    const suite = await db.testSuite.create({ data: { projectId: hub.id, name: `Smoke ${TAG}`, cases: { create: { caseId: c.id, position: 0 } } } });
    await db.projectGroup.update({ where: { id: group.id }, data: { platforms: [{ name: "Web", suiteIds: [suite.id] }, { name: "Unity", suiteIds: [] }] } });
  } finally {
    await db.$disconnect();
  }

  // #6: from the Web test cycle, Create a run has Web ticked.
  await page.goto(`/p/${web}`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await pickKind(page);
  await expect(box.getByRole("checkbox", { name: `${NAME} Web RC4` })).toBeChecked();
  await expect(box.getByRole("checkbox", { name: `${NAME} Unity RC4` })).not.toBeChecked();

  // #7: every case to Dana: the box stops opening the runner and the run page has her link.
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  await expect(box.getByRole("button", { name: "Create and test now" })).toBeVisible();
  await box.getByRole("button", { name: /More details \(optional\)/ }).click();
  await box.getByLabel("Assign every case to").selectOption({ label: "Dana Lead" });
  await expect(box.getByRole("button", { name: "Create and test now" })).toHaveCount(0);
  await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${web}/runs/1\\?handed=`));
  const note = page.getByTestId("hand-off");
  await expect(note).toContainText("Started R1 with 1 case for Dana Lead. No email goes out, so send them the link.");
  await expect(note).toContainText(`/p/${web}/runs/1`);
  await expect(note.getByRole("button", { name: "Copy link for Dana" })).toBeVisible();
  await note.getByRole("button", { name: "Hide this note" }).click();
  await expect(note).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/p/${web}/runs/1$`));

  // A1: at Largest text on a laptop screen, the run list (folded) sits above the case and the steps show.
  const check = new PrismaClient();
  try {
    await check.user.update({ where: { email: "admin@example.com" }, data: { textSize: "150" } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/p/${web}/runs/1/execute`);
    const steps = page.getByRole("group", { name: "Step 1 status" });
    await expect(steps).toBeVisible();
    // ver_94 #15: the run list folds behind a "Run list" button above the case.
    const fold = page.getByRole("button", { name: /^Run list \(/ });
    const list = await fold.boundingBox();
    const step = await steps.boundingBox();
    expect(list!.y + list!.height).toBeLessThanOrEqual(step!.y);
    expect(step!.width).toBeGreaterThan(200);
    await fold.click();
    await expect(page.getByRole("list", { name: "Run list" })).toBeVisible();
  } finally {
    await check.user.update({ where: { email: "admin@example.com" }, data: { textSize: "100" } });
    await check.$disconnect();
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // #27: Start next release offers to close RC4's open run, ticked.
  await page.goto(home);
  await openReleaseBox(page);
  const rc = page.getByRole("dialog");
  await rc.getByLabel("Release", { exact: true }).fill("RC5");
  await choosePlatform(page, "Web", /suites again/);
  // ver_99: nothing carries over unless you tick it.
  const close = rc.getByRole("checkbox", { name: /Close RC4's 1 open run/ });
  await expect(close).not.toBeChecked();
  await close.check();
  await expect(rc.getByText(`In ${NAME} Web RC4. Each can be reopened from its run page's More menu.`)).toBeVisible();
  await rc.getByRole("button", { name: "Start RC5" }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await page.goto(`/p/${web}/runs/1`);
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
});
