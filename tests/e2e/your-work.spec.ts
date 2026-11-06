import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Your work on the Umbrellas page shows 3 runs until Show all (remembered per person),
// names runs in plain words ("Run 2"), and skips work left in archived test cycles.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Busy ${TAG}`;
const EMAIL = `yw-${TAG.toLowerCase()}@example.com`;
let groupId = "";

test.beforeAll(async () => {
  // One umbrella, two test cycles. The live cycle has 4 runs for the tester (one already started);
  // the archived cycle has 1 more that must not show anywhere.
  const db = new PrismaClient();
  try {
    const tester = await db.user.create({ data: { email: EMAIL, name: "Sam Busy", whatsNewSeen: 9999 } });
    const members = { create: [{ userId: tester.id, role: "TESTER" as const }] };
    const hub = await db.project.create({ data: { key: `WH${TAG}`, name: NAME, members } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id } })).id;
    const live = await db.project.create({ data: { key: `WL${TAG}`, name: `${NAME} Web RC 1`, groupId, members, runSeq: 4 } });
    const old = await db.project.create({
      data: { key: `WO${TAG}`, name: `${NAME} Old RC`, groupId, members, runSeq: 1, archivedAt: new Date() },
    });
    const tcs: Awaited<ReturnType<typeof db.testCase.create>>[] = [];
    for (const n of [1, 2])
      tcs.push(
        await db.testCase.create({
          data: {
            projectId: hub.id, number: n, title: `Case ${n}`, tags: [],
            versions: { create: { version: 1, title: `Case ${n}`, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [] } },
          },
        }),
      );
    const run = (projectId: string, number: number, name: string, statuses: ("UNTESTED" | "PASSED")[], at: Date) =>
      db.testRun.create({
        data: {
          projectId, number, name, createdAt: at,
          entries: {
            create: statuses.map((status, i) => ({
              caseId: tcs[i].id, caseVersion: 1, position: i, title: tcs[i].title, priority: tcs[i].priority, steps: [], status, assigneeId: tester.id,
            })),
          },
        },
      });
    const day = (n: number) => new Date(Date.UTC(2026, 9, n));
    // Oldest run is the started one, so it should still come first.
    await run(live.id, 1, "Started first", ["PASSED", "UNTESTED"], day(1));
    await run(live.id, 2, "Second", ["UNTESTED"], day(2));
    await run(live.id, 3, "Third", ["UNTESTED", "UNTESTED"], day(3));
    await run(live.id, 4, "Fourth newest", ["UNTESTED"], day(4));
    await run(old.id, 1, "Left in archive", ["UNTESTED"], day(5));
  } finally {
    await db.$disconnect();
  }
});

test("Your work stays short, opens in place, and skips archived test cycles", async ({ page }) => {
  await signIn(page, EMAIL, "Sam Busy");
  await page.goto("/");
  const work = page.getByRole("heading", { name: "Your work" }).locator("..");
  await expect(work.getByTestId("your-work-total")).toHaveText("5 cases waiting in 4 runs");
  const links = work.getByRole("link", { name: /Test my cases/ });
  await expect(links).toHaveCount(3);
  // Started runs first, then the newest; the run's version (or start day) after the test cycle, never "Run N".
  await expect(work.getByRole("listitem").first()).toContainText(new RegExp(`Started first · ${NAME} Web RC 1 · .+ · 1 case waiting`));
  await expect(work.getByRole("listitem").nth(1)).toContainText("Fourth newest");
  await expect(links.first()).toHaveAccessibleName("Test my cases in Started first");
  await expect(work.getByText("Left in archive")).toHaveCount(0);

  await work.getByRole("button", { name: "Show all 4 runs" }).click();
  await expect(links).toHaveCount(4);
  await expect(links.nth(3)).toBeFocused();
  // Remembered for this person.
  await page.reload();
  await expect(links).toHaveCount(4);
  await work.getByRole("button", { name: "Show fewer" }).click();
  await expect(links).toHaveCount(3);

  // The umbrella's My assigned cases page skips the archived test cycle too.
  await page.goto(`/g/${groupId}/runs?mine=1`);
  await expect(page.getByRole("heading", { name: "My assigned cases" })).toBeVisible();
  await expect(page.getByText("Fourth newest")).toBeVisible();
  await expect(page.getByText("Left in archive")).toHaveCount(0);
});
