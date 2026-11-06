import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_97: a shared step with several checks in it gives each check its own result, and anyone
// who isn't only a Viewer can make a new umbrella.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `CK${TAG}`;
const VIEWER = `viewer-${TAG.toLowerCase()}@example.com`;
let entryId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 97 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const viewer = await db.user.create({ data: { email: VIEWER, name: "Vic Viewer", whatsNewSeen: 97 } });
    const project = await db.project.create({
      data: { key: KEY, name: `Checks ${TAG}`, caseSeq: 1, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: viewer.id, role: "VIEWER" }] } },
    });
    const title = "Comments panel";
    const c = await db.testCase.create({ data: { projectId: project.id, number: 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [] } } } });
    // The run's own copy of the steps, as a shared step expands into it.
    const shared = { id: "comments", name: "Comments", version: 1 };
    const steps = [
      { number: "1.1", action: "COMMENTS SHARED STEPS", expected: "", shared },
      { number: "1.2", action: "Add Comments\nComment Subject\nThe subject can contain letters.\nThe subject can contain numbers.\nThe subject must be at least 1 character long.", expected: "Not supported by: UNITY", shared },
      { number: "1.3", action: "Remove Comments\nComments can be removed.\nA Confirmation Window appears when removing a comment.", expected: "", shared },
      { number: "2", action: "Close the panel", expected: "The panel closes" },
    ];
    const run = await db.testRun.create({
      data: { projectId: project.id, number: 1, name: "Checks", createdBy: "Demo Admin", entries: { create: [{ caseId: c.id, caseVersion: 1, position: 0, title, priority: "MEDIUM", steps }] } },
      include: { entries: true },
    });
    entryId = run.entries[0].id;
  } finally {
    await db.$disconnect();
  }
});

test("each check in a shared step gets its own result, and the step's result rolls up", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${entryId}`);

  // A capitals row is a heading; a step with several lines lists its checks under its name.
  await expect(page.getByText("heading, no result needed")).toBeVisible();
  await expect(page.getByText("Not on UNITY")).toBeVisible();
  await expect(page.getByText("Comment Subject", { exact: true })).toBeVisible();
  const check = (text: string) => page.getByRole("group", { name: `Check: ${text}` });
  const step = (n: string) => page.getByRole("group", { name: `Step ${n} status` });

  // One failed check fails the step.
  await check("The subject can contain letters.").getByRole("button", { name: "Passed" }).click();
  await check("The subject can contain numbers.").getByRole("button", { name: "Failed" }).click();
  await expect(step("1.2").getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("2 of 3 checks")).toBeVisible();

  // The step's own Passed fills the check that's left; the failed one stays failed.
  await step("1.2").getByRole("button", { name: "Passed" }).click();
  await expect(check("The subject must be at least 1 character long.").getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(step("1.2").getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");
  // Pressing it again sets every check.
  await step("1.2").getByRole("button", { name: "Passed" }).click();
  await expect(check("The subject can contain numbers.").getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(step("1.2").getByText("Set from its checks")).toBeVisible();

  // Keys go check by check: P marks this check and moves to the next one.
  await check("Comments can be removed.").getByRole("button", { name: "Passed" }).click();
  await check("Comments can be removed.").getByRole("button", { name: "Passed" }).click(); // pressing it again clears it
  await expect(check("Comments can be removed.").getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "false");
  await page.locator("body").press("p");
  await page.locator("body").press("p");
  await expect(step("1.3").getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await page.locator("body").press("p");
  await expect(step("2").getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");

  // The heading never needs a result: the case passes.
  await expect(page.getByText("from steps: 3 passed")).toBeVisible();
  await page.getByRole("button", { name: /^Save and (finish|next)$/ }).click();
  await expect(page.getByText(/That was the last case in this run|Passed/).first()).toBeVisible();

  // The checks are saved with the result.
  const db = new PrismaClient();
  try {
    const result = await db.testResult.findFirstOrThrow({ where: { entryId }, orderBy: { createdAt: "desc" } });
    const saved = result.stepResults as { status: string; checks?: string[] }[];
    expect(result.status).toBe("PASSED");
    expect(saved.map((s) => s.status)).toEqual(["UNTESTED", "PASSED", "PASSED", "PASSED"]);
    expect(saved[1].checks).toEqual(["PASSED", "PASSED", "PASSED"]);
    expect(saved[3].checks).toBeUndefined();
  } finally {
    await db.$disconnect();
  }
  // Reopened, the saved result matches its steps (the heading doesn't count against it).
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${entryId}`);
  await expect(page.getByText("Set from its checks").first()).toBeVisible();
  await expect(page.getByText(/Use the steps' result/)).toHaveCount(0);
});

test("New umbrella is there for Leads, not Viewers (ver_187: Admins and Leads only)", async ({ browser }) => {
  for (const [email, name, sees] of [
    ["lead@example.com", "Dana Lead", true],
    [VIEWER, "Vic Viewer", false],
  ] as const) {
    const page = await (await browser.newContext()).newPage();
    await signIn(page, email, name);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /New umbrella|Make your first umbrella/ })).toHaveCount(sees ? 1 : 0);
    await page.context().close();
  }
});
