import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_83: umbrella settings open in place, a test cycle counts the Case library,
// the runner never drops a step result, no "Bug found" (ver_94), and "Your work" on the Umbrellas page.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `YH${TAG}`;
const CYCLE = `YC${TAG}`;
const NAME = `Work ${TAG}`;
const EMAIL = `w83-${TAG.toLowerCase()}@example.com`;

let groupId = "";

test.beforeAll(async () => {
  // One umbrella with two library cases and one run in its test cycle, all assigned to a fresh tester.
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({
      where: { email: "admin@example.com" },
    });
    const tester = await db.user.create({
      data: { email: EMAIL, name: "Robin Tester", whatsNewSeen: 9999 },
    });
    const members = {
      create: [
        { userId: admin.id, role: "ADMIN" as const },
        { userId: tester.id, role: "TESTER" as const },
      ],
    };
    const hub = await db.project.create({
      data: { key: HUB, name: NAME, members },
    });
    groupId = (
      await db.projectGroup.create({
        data: { name: NAME, hubProjectId: hub.id },
      })
    ).id;
    const cycle = await db.project.create({
      data: {
        key: CYCLE,
        name: `${NAME} Web RC1`,
        groupId,
        members,
        runSeq: 1,
      },
    });
    const steps = [
      { kind: "step", action: "Open the sign in page", expected: "Form shows" },
      { kind: "step", action: "Sign in", expected: "Home page shows" },
    ];
    const cases = [];
    for (const [i, title] of ["Sign in with email", "Sign out"].entries())
      cases.push(
        await db.testCase.create({
          data: {
            projectId: hub.id,
            number: i + 1,
            title,
            tags: [],
            versions: {
              create: {
                version: 1,
                title,
                preconditions: "",
                priority: "MEDIUM",
                type: "MANUAL",
                tags: [],
                steps,
              },
            },
          },
        }),
      );
    await db.project.update({ where: { id: hub.id }, data: { caseSeq: 2 } });
    await db.testRun.create({
      data: {
        projectId: cycle.id,
        number: 1,
        name: "Smoke",
        entries: {
          create: cases.map((c, i) => ({
            caseId: c.id,
            caseVersion: 1,
            position: i,
            title: c.title,
            priority: c.priority,
            steps: steps.map((s, j) => ({
              number: String(j + 1),
              action: s.action,
              expected: s.expected,
            })),
            assigneeId: tester.id,
          })),
        },
      },
    });
  } finally {
    await db.$disconnect();
  }
});

test("a tester starts from Your work, and the runner keeps every step result", async ({
  page,
}) => {
  await signIn(page, EMAIL, "Robin Tester");
  await page.goto("/");

  // Your work: one row per run, straight into my cases.
  const work = page.getByRole("heading", { name: "Your work" }).locator("..");
  await expect(work.getByText("Smoke", { exact: true })).toBeVisible();
  await expect(work.getByTestId("your-work-total")).toHaveText("2 cases waiting in 1 run");
  await expect(
    work.getByText(new RegExp(`· ${NAME} Web RC1 · .+ · 2 cases waiting`)),
  ).toBeVisible();
  // Only one umbrella: nothing to reorder. (Its ⋯ menu shows since ver_96's open permissions.)
  await expect(page.getByRole("region", { name: `${NAME} umbrella` }).locator('[draggable="true"]')).toHaveCount(0);
  await work.getByRole("link", { name: "Test my cases" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1/execute`));
  await expect(
    page.getByRole("heading", { name: "Sign in with email" }),
  ).toBeVisible();

  // Pressing a set status again keeps it; Clear and U empty a step.
  const step1 = page.getByRole("group", { name: "Step 1 status" });
  await step1.getByRole("button", { name: "Passed" }).click();
  await step1.getByRole("button", { name: "Passed" }).click();
  await expect(step1.getByRole("button", { name: "Passed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Clear step 1" }).click();
  await expect(step1.getByRole("button", { name: "Passed" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // Keys too: F twice stays Failed (Failed doesn't move on), U empties it.
  const failed = step1.getByRole("button", { name: "Failed" });
  await page.keyboard.press("f");
  await expect(failed).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("f");
  await expect(failed).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("u");
  await expect(failed).toHaveAttribute("aria-pressed", "false");

  // Save and next with no step marked asks first.
  await page.getByRole("button", { name: "Save and next" }).click();
  const ask = page.getByRole("alert").filter({ hasText: "has no result yet" });
  await expect(ask).toContainText("All 2 steps are still Untested.");
  await ask.getByRole("button", { name: "Stay here" }).click();
  await expect(ask).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Sign in with email" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save and next" }).click();
  await ask.getByRole("button", { name: "Pass all and next" }).click();
  await expect(page.getByRole("heading", { name: "Sign out" })).toBeVisible();

  // The second case is left for later and stays Untested.
  await page.getByRole("button", { name: "Save and finish" }).click();
  await ask.getByRole("button", { name: "Leave it for later" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Sign in with email" })
      .getByText("Passed"),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Sign out" }).getByText("Untested"),
  ).toBeVisible();

  // Back home: one case left.
  await page.goto("/");
  await expect(
    page.getByText(new RegExp(`· ${NAME} Web RC1 · .+ · 1 case waiting`)),
  ).toBeVisible();
});

test("umbrella settings open in place; the test cycle counts the Case library; pass/fail only", async ({
  page,
}) => {
  await signIn(page, "admin@example.com", "Demo Admin");

  // Members and Jira open on the umbrella's own Settings page.
  await page.goto(`/g/${groupId}/settings`);
  await page
    .getByRole("button", { name: "Manage", exact: true })
    .first()
    .click();
  await expect(page.getByText("Robin Tester")).toBeVisible();
  await page.locator("[data-howto=settings-jira]").click();
  await expect(page.getByLabel("Jira site")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings`));

  // The hub's old settings address lands there too, with the form open.
  await page.goto(`/p/${HUB}/settings#members`);
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/settings#members`));
  await expect(page.getByText("Robin Tester")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test cycle settings" })).toHaveCount(0);

  // The test cycle's Overview counts what it can run from the library.
  await page.goto(`/p/${CYCLE}`);
  await expect(page.getByText("Cases it can run")).toBeVisible();
  await expect(page.getByText(`from ${NAME} case library`)).toBeVisible();
  await page.goto(`/p/${CYCLE}/cases`);
  await expect(page.getByText("No cases of its own")).toBeVisible();
  await page
    .getByRole("link", { name: `Open the ${NAME} case library` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}/cases`));

  // ver_94: pass/fail only, so neither Bug found nor Defective is offered.
  await page.goto(`/p/${CYCLE}/runs/1/execute`);
  const step1 = page.getByRole("group", { name: "Step 1 status" });
  await expect(step1.getByRole("button", { name: "Failed" })).toBeVisible();
  await expect(step1.getByRole("button", { name: "Bug found" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Defective" })).toHaveCount(0);
});
