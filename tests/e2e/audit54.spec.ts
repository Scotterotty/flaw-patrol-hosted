import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// Leftover fixes from the build 54 usability audit: one bar on a half-done session,
// charter reminders shown once, Import a run's breadcrumb and width, a timer bar and
// case cards on phones, and a fade on Reports tabs that run off the edge.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `AU${TAG}`;
const NAME = `Audit ${TAG}`;
const ids = { session: "", manual: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.user.update({ where: { id: admin.id }, data: { whatsNewSeen: 999 } });
    const project = await db.project.create({
      data: { key: KEY, name: NAME, caseSeq: 2, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } },
    });
    const steps = [{ number: "1", action: "Open the cart", expected: "The cart shows" }];
    const manual = await db.testCase.create({
      data: { projectId: project.id, number: 1, title: "Pay with a saved card", versions: { create: { version: 1, title: "Pay with a saved card", preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps } } },
    });
    const charter = { explore: "Checkout with saved cards", with: "Two test accounts", discover: "Where payment errors are unclear", minutes: 30, reminders: [{ id: "r1", repeat: true, sec: 600, text: `Take a screenshot ${TAG}` }], prompts: [] };
    const explore = await db.testCase.create({
      data: { projectId: project.id, number: 2, title: "Explore checkout", versions: { create: { version: 1, title: "Explore checkout", preconditions: "", priority: "MEDIUM", type: "EXPLORATORY", tags: [], steps: [], charter } } },
    });
    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        number: 1,
        name: "Checkout check",
        createdBy: "Demo Admin",
        entries: {
          create: [
            { caseId: manual.id, caseVersion: 1, position: 0, title: "Pay with a saved card", priority: "HIGH", steps },
            {
              caseId: explore.id,
              caseVersion: 1,
              position: 1,
              title: "Explore checkout",
              priority: "MEDIUM",
              steps: [],
              kind: "EXPLORATORY",
              charter,
              assigneeId: admin.id,
              status: "IN_PROGRESS",
              draft: { stepResults: [], elapsedSec: 125, notes: [{ id: "n1", at: 60, kind: "note", text: "Saved card list loads", attachments: [], defect: null }] },
              draftAt: new Date(Date.now() - 3 * 60_000),
              draftById: admin.id,
              draftByName: "Demo Admin",
            },
          ],
        },
      },
      include: { entries: true },
    });
    ids.manual = run.entries.find((e) => e.position === 0)!.id;
    ids.session = run.entries.find((e) => e.position === 1)!.id;
  } finally {
    await db.$disconnect();
  }
});

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test("a half-done session says so in one bar, and its reminders show once", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.session}`);

  const note = page.getByTestId("resume-note");
  await expect(note).toHaveText(/^Picked up where you left off .+, timer paused at 2:05\.$/);
  await expect(page.getByText(/Picked up where/)).toHaveCount(1);
  await expect(page.getByText("You're exploring this.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("stop-testing-help")).toContainText("Your notes are kept");

  // Reminders are in the Timer panel, not again in the Mission box.
  await expect(page.getByRole("region", { name: "Timer" }).getByText(`Take a screenshot ${TAG}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Mission" }).getByText(`Take a screenshot ${TAG}`)).toHaveCount(0);

  // Keep exploring in the bar starts the clock, and the picked-up line goes.
  await page.getByRole("button", { name: "Keep exploring" }).first().click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("Import a run has one breadcrumb and the Test runs width", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs/import`);
  await expect(page.getByRole("heading", { name: "Import a run" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Import a run");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).not.toContainText("Rimport");
  await expect(page.getByText("Test runs / Import a run")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the session timer stays in view, and run cases keep their button on screen", async ({ page }) => {
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.session}`);
    const bar = page.getByTestId("phone-timer");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("27:55");
    await page.mouse.wheel(0, 2000);
    await expect(bar).toBeInViewport();
    await noSideScroll(page);

    await page.goto(`/p/${KEY}/runs/1`);
    const test1 = page.getByRole("link", { name: "Test", exact: true });
    await test1.scrollIntoViewIfNeeded();
    await expect(test1).toBeInViewport({ ratio: 1 });
    await noSideScroll(page);
  });

  test("Reports tabs that run off the edge fade and show there are more", async ({ page }) => {
    await signIn(page, "admin@example.com", "Demo Admin");
    await page.goto(`/p/${KEY}/reports`);
    await expect(page.getByTestId("more-tabs").first()).toBeVisible();
    await noSideScroll(page);
  });
});
