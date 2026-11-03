import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_150: a step with nothing to check (a line in capitals with no expected result, or a dash or
// N/A as its expected result) is a section title for the steps below it. It takes no number and
// no result buttons, and a short instruction with no expected result stays a real step.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `ST${TAG}`;
const ids = { entry: "" };

const items = [
  { kind: "step", action: "SIGN IN / OUT STEPS", expected: "–" },
  { kind: "step", action: "Sign in with a valid account.", expected: "The home page opens with your name at the top." },
  { kind: "step", action: "Open Settings", expected: "" },
  { kind: "step", action: "ACCOUNT SETTINGS", expected: "" },
  { kind: "step", action: "Change your display name and save.", expected: "The new name shows in the top bar." },
];
// The run's copy, numbered the way the app numbers it.
const snapshot = [
  { number: "", action: items[0].action, expected: items[0].expected },
  { number: "1", action: items[1].action, expected: items[1].expected },
  { number: "2", action: items[2].action, expected: items[2].expected },
  { number: "", action: items[3].action, expected: items[3].expected },
  { number: "3", action: items[4].action, expected: items[4].expected },
];

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 150 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({
      data: { key: KEY, name: `Section titles ${TAG}`, caseSeq: 1, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } },
    });
    const title = "Sign in and settings";
    const c = await db.testCase.create({
      data: { projectId: project.id, number: 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps: items } } },
    });
    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        number: 1,
        name: "Titles",
        createdBy: "Demo Admin",
        entries: { create: [{ caseId: c.id, caseVersion: 1, position: 0, title, priority: "HIGH", steps: snapshot }] },
      },
      include: { entries: true },
    });
    ids.entry = run.entries[0].id;
  } finally {
    await db.$disconnect();
  }
});

test("steps with nothing to check show as section titles", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");

  // Case page: titles are heading rows with no number; the steps count 1, 2, 3.
  await page.goto(`/p/${KEY}/cases/1`);
  const table = page.locator("[data-steps-table]");
  await expect(table.getByRole("rowheader", { name: "SIGN IN / OUT STEPS" })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: "ACCOUNT SETTINGS" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Change your display name" }).getByRole("cell").first()).toHaveText("3");

  // Runner: no buttons on titles, buttons on all three real steps ("Open Settings" included).
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.entry}`);
  await expect(page.getByRole("heading", { name: "SIGN IN / OUT STEPS", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ACCOUNT SETTINGS", level: 3 })).toBeVisible();
  for (const n of ["1", "2", "3"]) await expect(page.getByRole("group", { name: `Step ${n} status` })).toBeVisible();
  await expect(page.getByText("3 steps left").or(page.getByText("Mark the steps above"))).toBeVisible();

  // Editor: the title rows say so before saving; the instruction says it has no expected result.
  await page.goto(`/p/${KEY}/cases/1/edit`);
  await expect(page.getByText("Section title", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Step with no expected result", { exact: true })).toHaveCount(1);
});
