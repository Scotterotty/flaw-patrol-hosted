import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { pickKind } from "./projects";

// ver_178: first-day flow fixes from the ver_177 audit.
// 1. The Overview says one thing: Start here, no cards repeating the left menu, no shortcuts before the first run.
// 2. Create a run ticks the only test cycle; Release candidate is "Create a run · Release candidate" with Change
//    and the same Whole Case library choice.
// 3. A run's More menu keeps every spreadsheet action under Spreadsheet.
// 4. The How-to guide opens from the first page, and starts with Start here.
// 5. A test cycle page has Invite in its header and one "nothing yet" line instead of empty boxes.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `FD${TAG}`;
const CYCLE = `FE${TAG}`;
const NAME = `First day ${TAG}`;
const ids = { group: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 2, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    await db.project.create({ data: { key: CYCLE, name: `${NAME} Web 1.0`, groupId: group.id, platform: "Web", rcName: "1.0", runSeq: 0, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    for (const [i, title] of ["Sign in", "Check out"].entries()) await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title } });
  } finally {
    await db.$disconnect();
  }
});

test("Overview, Create a run, the release box and a run's More menu", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");

  // 1. Start here, with the How-to guide; no shortcuts or cards yet.
  await page.goto(`/g/${ids.group}`);
  await expect(page.getByRole("heading", { name: "Start here" })).toBeVisible();
  await expect(page.getByText("Shortcuts", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Groups of cases you run together")).toHaveCount(0);
  await page.getByTestId("open-how-to").click();
  await expect(page.getByRole("region", { name: "Start here" })).toBeVisible();
  await page.getByRole("button", { name: "Close the How-to guide" }).click();

  // 2. Create a run: the only test cycle is ticked.
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  await expect(box.getByRole("checkbox", { name: `${NAME} Web 1.0` })).toBeChecked();
  await expect(box.getByTestId("run-todo")).toContainText(`Goes in ${NAME} Web 1.0`);
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  await box.getByRole("button", { name: "Create smoke test" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));

  // 3. More: Edit details, then Spreadsheet with its actions, then Close run.
  await page.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu");
  const sheet = menu.getByRole("group", { name: "Spreadsheet" });
  await expect(sheet.getByRole("link", { name: "Bring in results from a sheet" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Download as Excel" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Send to a Google Sheet" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Now there's a run: the Overview's shortcuts come back.
  await page.goto(`/g/${ids.group}`);
  await expect(page.getByText("Shortcuts", { exact: true })).toBeVisible();

  // 2. Release candidate: Create a run on its kind, with Change and Whole Case library.
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Release candidate/ }).click();
  const rc = page.getByRole("dialog", { name: "Create a run · Release candidate" });
  await expect(rc).toBeVisible();
  await expect(rc).not.toContainText("For any other testing");
  await rc.getByRole("checkbox", { name: "Web", exact: true }).check();
  const pick = rc.getByRole("group", { name: "Pick test cases for Web" });
  await expect(pick.getByTestId("rc-whole-library")).toContainText("All 2 cases");
  await rc.getByTestId("rc-change-kind").click();
  await expect(page.getByRole("dialog").getByRole("group", { name: "Kind of run" })).toBeVisible();
});

test("the test cycle page doesn't repeat itself", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${CYCLE}`);
  await expect(page.getByTestId("cycle-invite")).toHaveAttribute("href", `/g/${ids.group}/settings#members`);
  await expect(page.getByPlaceholder("name@company.com, another@company.com")).toHaveCount(0);
  await expect(page.getByTestId("cycle-nothing-yet")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flaky cases" })).toHaveCount(0);
});
