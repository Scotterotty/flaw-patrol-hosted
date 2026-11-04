import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_165: a case with only a title runs like any other case. Its title shows as step 1,
// with "Works as described." as a grey hint under Expected and the usual step buttons.
// A lone step with an empty Step box shows the title there.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `TO${TAG}`;
const EMAIL = `title-only-${TAG.toLowerCase()}@example.com`;
const ids: { only: string; empty: string } = { only: "", empty: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: EMAIL, name: "Tia Titles", whatsNewSeen: 999 } });
    const project = await db.project.create({ data: { key: KEY, name: `Title only ${TAG}`, caseSeq: 2, runSeq: 1, members: { create: [{ userId: user.id, role: "ADMIN" }] } } });
    const make = (number: number, title: string, steps: object[]) =>
      db.testCase.create({ data: { projectId: project.id, number, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps } } } });
    const only = await make(1, "ENSURE ONE USER IS SCREEN RECORDING", []);
    const empty = await make(2, "Site Model", [{ kind: "step", action: "", expected: "Model loads" }]);
    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        number: 1,
        name: "Dry run",
        entries: {
          create: [
            { caseId: only.id, caseVersion: 1, position: 0, title: only.title, priority: "MEDIUM", steps: [] },
            { caseId: empty.id, caseVersion: 1, position: 1, title: empty.title, priority: "MEDIUM", steps: [{ number: "1", action: "", expected: "Model loads" }] },
          ],
        },
      },
      include: { entries: { orderBy: { position: "asc" } } },
    });
    ids.only = run.entries[0].id;
    ids.empty = run.entries[1].id;
  } finally {
    await db.$disconnect();
  }
});

test("a title-only case shows its title as step 1 and that step sets the case result", async ({ page }) => {
  await signIn(page, EMAIL, "Tia Titles");
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.only}`);
  await expect(page.getByText("This case has no steps")).toHaveCount(0);
  const step = page.locator("li[data-step='0']");
  await expect(step.getByText("ENSURE ONE USER IS SCREEN RECORDING")).toBeVisible();
  await expect(step.getByTestId("title-only-hint")).toHaveText("Works as described.");
  const buttons = page.getByRole("group", { name: "Step 1 status" });
  await buttons.getByRole("button", { name: "Passed" }).click();
  await expect(buttons.getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^Save and (next|finish)$/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`entry=${ids.empty}`), { timeout: 30_000 });

  const db = new PrismaClient();
  try {
    const saved = await db.testResult.findFirst({ where: { entryId: ids.only }, orderBy: { createdAt: "desc" } });
    expect(saved?.status).toBe("PASSED");
    expect((saved?.stepResults as unknown[]).length).toBe(1);
  } finally {
    await db.$disconnect();
  }

  // A lone step with an empty Step box shows the title, and keeps its Expected.
  const lone = page.locator("li[data-step='0']");
  await expect(lone.getByText("Site Model", { exact: true })).toBeVisible();
  await expect(lone.getByText("Model loads")).toBeVisible();
  await expect(lone.getByTestId("title-only-hint")).toHaveCount(0);
});
