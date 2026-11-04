import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Write a bug (Scott, Nov 4 2026): a bug that isn't from a test case, run or bug bash.
// + Write a bug on the Bugs page, on Overview, as a + next to Bugs in the left menu and in
// Ctrl+K. Plain or one of the team's templates; it saves on the Bugs page with a
// "Written on its own" chip, and the filter finds it.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `WB${TAG}`;
const HUB = `WH${TAG}`;
const NAME = `Writing ${TAG}`;
const ids = { project: "", group: "", ios: "", android: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await db.user.findUniqueOrThrow({ where: { email: "tester@example.com" } });
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    // A test cycle on its own, with one team template.
    const project = await db.project.create({ data: { key: KEY, name: `Bugs on their own ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    ids.project = project.id;
    const s = (id: string, heading: string, source: string, extra = {}) => ({ id, heading, source, hint: "", choices: [], must: false, types: "", paste: false, columns: [], growing: false, ...extra });
    await db.bugTemplate.create({
      data: {
        projectId: project.id,
        name: "Crash",
        hint: "The app closes or freezes",
        layout: { title: { platform: false, area: false, build: false }, sections: [s("r", "Repro steps", "steps"), s("c", "Crash log", "text", { must: true })], shot: false, fields: [], from: "" },
      },
    });
    // An umbrella with two current test cycles; the lead only views it.
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: [{ userId: tester.id, role: "TESTER" }, { userId: lead.id, role: "VIEWER" }] } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "iOS" }, { name: "Android" }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const cycle = (key: string, platform: string) => db.project.create({ data: { key, name: `${NAME} ${platform} 1.4`, groupId: group.id, platform, members: { create: [{ userId: tester.id, role: "TESTER" }, { userId: lead.id, role: "VIEWER" }] } } });
    ids.ios = (await cycle(`WI${TAG}`, "iOS")).id;
    ids.android = (await cycle(`WA${TAG}`, "Android")).id;
  } finally {
    await db.$disconnect();
  }
});

test("write a bug from Overview and the left menu, with Plain or a template", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // Overview: + Write a bug next to Create a run lands on Bugs with the box open.
  await page.goto(`/p/${KEY}`);
  await page.getByTestId("overview-write-bug").click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/bugs`));
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box).toBeVisible();
  const picker = box.getByTestId("template-picker");
  await expect(picker.getByRole("radio", { name: "Plain" })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("radio", { name: "Crash" })).toBeVisible();
  await box.getByLabel("Summary").fill("Settings icon is blurry on big screens");
  await box.getByLabel("Steps to reproduce").fill("1. Open Settings on a 4K monitor");
  await box.getByLabel("What happened").fill("The icon is fuzzy");
  await box.getByLabel("Found in").fill("1.4.2");
  await box.getByRole("button", { name: "Save bug" }).click();
  await expect(box).toHaveCount(0);
  // ?write=1 comes off, so a refresh doesn't open the box again.
  await expect(page).not.toHaveURL(/write=1/);
  const row = page.locator("tr").filter({ hasText: "Settings icon is blurry on big screens" });
  await expect(row.getByTestId("written-chip")).toHaveText("Written on its own");
  await expect(row.getByTestId("bug-found-in")).toHaveText("Version 1.4.2");
  await expect(row).not.toContainText("Not linked to a result yet");

  // The + next to Bugs in the left menu, from another page; Crash's run heading becomes a box to type in.
  await page.goto(`/p/${KEY}/cases`);
  await page.getByTestId("menu-plus").click();
  await expect(box).toBeVisible();
  await picker.getByRole("radio", { name: "Crash" }).click();
  await expect(box.getByLabel("Repro steps")).toBeVisible();
  await box.getByLabel("Summary").fill("App closes when saving a draft");
  await box.getByLabel("Repro steps").fill("1. Write a draft\n2. Press Save");
  await expect(box.getByTestId("template-missing")).toContainText("Crash log");
  await expect(box.getByRole("button", { name: "Save bug" })).toBeDisabled();
  await box.getByLabel("Crash log").fill("SIGSEGV in DraftStore.save");
  await box.getByRole("button", { name: "Save bug" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.locator("tr").filter({ hasText: "App closes when saving a draft" }).getByTestId("written-chip")).toBeVisible();

  const db = new PrismaClient();
  try {
    const bug = await db.defect.findFirstOrThrow({ where: { projectId: ids.project, title: "App closes when saving a draft" } });
    expect(bug.templateName).toBe("Crash");
    expect(bug.description).toContain("Crash log\nSIGSEGV in DraftStore.save");
    expect((bug.layout as { written?: boolean }).written).toBe(true);
  } finally {
    await db.$disconnect();
  }

  // The filter: written ones, or none from tests.
  await page.getByLabel("Where it came from").selectOption("own");
  await expect(page).toHaveURL(/from=own/);
  await expect(page.getByTestId("written-chip")).toHaveCount(2);
  await page.getByLabel("Where it came from").selectOption("tests");
  await expect(page.getByText("No bugs match")).toBeVisible();
});

test("in an umbrella you pick the test cycle, Ctrl+K finds it, and Viewers don't see it", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signIn(page, "tester@example.com", "Sam Tester");
  await page.goto(`/g/${ids.group}`);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("write a bug");
  await search.getByRole("option", { name: /Write a bug/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/g/${ids.group}/bugs`));
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box).toBeVisible();
  const goesTo = box.getByLabel("Goes to");
  await expect(goesTo).toContainText("iOS 1.4");
  await expect(goesTo).toContainText("Android 1.4");
  await goesTo.selectOption({ label: "Android 1.4" });
  await box.getByLabel("Summary").fill(`Back button skips a screen ${TAG}`);
  await box.getByLabel("What happened").fill("It goes two screens back");
  await box.getByRole("button", { name: "Save bug" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.locator("tr").filter({ hasText: `Back button skips a screen ${TAG}` }).getByTestId("written-chip")).toBeVisible();
  const db = new PrismaClient();
  try {
    const bug = await db.defect.findFirstOrThrow({ where: { title: `Back button skips a screen ${TAG}` } });
    expect(bug.projectId).toBe(ids.android);
    expect(bug.createdBy).toBe("Sam Tester");
  } finally {
    await db.$disconnect();
  }

  // A Viewer can't file bugs, so there's no button, no + in the menu and nothing on Overview.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const viewer = await ctx.newPage();
  await signIn(viewer, "lead@example.com", "Dana Lead");
  await viewer.goto(`/g/${ids.group}/bugs?write=1`);
  await expect(viewer.getByRole("heading", { name: "Bugs" })).toBeVisible();
  await expect(viewer.getByTestId("write-bug")).toHaveCount(0);
  await expect(viewer.getByRole("dialog", { name: "Write a bug" })).toHaveCount(0);
  await expect(viewer.getByTestId("menu-plus")).toHaveCount(0);
  await viewer.goto(`/g/${ids.group}`);
  await expect(viewer.getByTestId("overview-write-bug")).toHaveCount(0);
  await ctx.close();
});

test("with Jira: file it straight into Jira, or keep it here and send it later", async ({ page }) => {
  test.setTimeout(180_000);
  const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;
  const JK = `WJ${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.project.create({ data: { key: JK, name: `Jira writing ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${JK}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();

  // Ticked (the default): it goes to Jira with its headings, and says where it was written.
  await page.goto(`/p/${JK}/bugs?write=1`);
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box.getByTestId("write-bug-jira")).toBeChecked();
  await box.getByLabel("Summary").fill(`Login spinner never stops ${TAG}`);
  await box.getByLabel("What happened").fill("The spinner keeps going after sign-in");
  await box.getByRole("button", { name: "Save and file in Jira" }).click();
  await expect(box).toHaveCount(0);
  const filed = page.locator("tr").filter({ hasText: `Login spinner never stops ${TAG}` });
  await expect(filed.getByRole("link", { name: /^QA-\d+$/ })).toBeVisible();
  await expect(filed.getByTestId("written-chip")).toBeVisible();
  const issues = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { summary: string; description: unknown }>;
  const issue = Object.values(issues).find((i) => i.summary === `Login spinner never stops ${TAG}`);
  expect(JSON.stringify(issue?.description)).toContain("What happened");
  expect(JSON.stringify(issue?.description)).toContain("The spinner keeps going after sign-in");
  expect(JSON.stringify(issue?.description)).toContain("written on the Bugs page");

  // Unticked: it stays here, and Send to Jira files it later with the same headings.
  await page.getByTestId("write-bug").click();
  await box.getByTestId("write-bug-jira").uncheck();
  await box.getByLabel("Summary").fill(`Typo on the pricing page ${TAG}`);
  await box.getByLabel("What happened").fill("It says Pirce");
  await box.getByRole("button", { name: "Save bug" }).click();
  await expect(box).toHaveCount(0);
  const kept = page.locator("tr").filter({ hasText: `Typo on the pricing page ${TAG}` });
  await expect(kept).toContainText("Saved here, not in Jira yet");
  await kept.getByRole("button", { name: "Send to Jira" }).click();
  await expect(kept.getByRole("link", { name: /^QA-\d+$/ })).toBeVisible();
  const after = (await (await fetch(`${JIRA}/__issues`)).json()) as Record<string, { summary: string; description: unknown }>;
  expect(JSON.stringify(Object.values(after).find((i) => i.summary === `Typo on the pricing page ${TAG}`)?.description)).toContain("It says Pirce");
});
