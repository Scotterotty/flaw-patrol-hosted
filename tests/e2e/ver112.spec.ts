import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_112: other people's progress shows in the runner's Run List and on the run page within a
// couple of seconds, without reloading, and keeps showing while you're partway through a case.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `LV${TAG}`;
const ids: string[] = [];

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 112 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    const project = await db.project.create({
      data: {
        key: KEY,
        name: `Live rows ${TAG}`,
        caseSeq: 3,
        runSeq: 1,
        members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: lead.id, role: "LEAD" }] },
      },
    });
    const steps = [
      { number: "1", action: "Open the cart", expected: "The cart opens" },
      { number: "2", action: "Press Pay", expected: "The payment form opens" },
    ];
    const cases = [];
    for (const [i, title] of ["Pay with a card", "Pay with a voucher", "Pay with points"].entries())
      cases.push(await db.testCase.create({ data: { projectId: project.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps } } } }));
    const run = await db.testRun.create({
      data: {
        projectId: project.id,
        number: 1,
        name: "Live rows",
        createdBy: "Demo Admin",
        entries: { create: cases.map((c, i) => ({ caseId: c.id, caseVersion: 1, position: i, title: c.title, priority: "HIGH" as const, steps })) },
      },
      include: { entries: { orderBy: { position: "asc" } } },
    });
    ids.push(...run.entries.map((e) => e.id));
  } finally {
    await db.$disconnect();
  }
});

const press = async (page: Page, key: string) => {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(key);
};

test("teammates' progress shows straight away, even while you're mid-case", async ({ browser }) => {
  const me = await (await browser.newContext()).newPage();
  const dana = await (await browser.newContext()).newPage();
  const watcher = await (await browser.newContext()).newPage();
  await signIn(me, "admin@example.com", "Demo Admin");
  await signIn(dana, "lead@example.com", "Dana Lead");
  await signIn(watcher, "admin@example.com", "Demo Admin");

  // I'm partway through the first case: my page holds its reloads so my work isn't wiped.
  await me.goto(`/p/${KEY}/runs/1/execute?entry=${ids[0]}`);
  await expect(me.getByRole("heading", { name: "Pay with a card" })).toBeVisible();
  await press(me, "p");
  const mine = me.locator(`a[title^="Pay with a card"]`);
  await expect(mine).toContainText("1/2");
  await watcher.goto(`/p/${KEY}/runs/1`);

  // Dana starts the second case.
  await dana.goto(`/p/${KEY}/runs/1/execute?entry=${ids[1]}`);
  await expect(dana.getByRole("heading", { name: "Pay with a voucher" })).toBeVisible();
  await press(dana, "p");

  const hers = me.locator(`a[title^="Pay with a voucher"]`);
  await expect(hers).toContainText("Dana Lead is testing now", { timeout: 6000 });
  await expect(hers).toContainText("In progress");
  await expect(hers).toContainText("1/2");
  const row = watcher.getByRole("row").filter({ hasText: "Pay with a voucher" });
  await expect(row).toContainText("Dana Lead is testing now", { timeout: 6000 });

  // Her next step shows too, and my own marked step is still there.
  await press(dana, "p");
  await expect(hers).toContainText("2/2", { timeout: 6000 });
  await expect(row).toContainText("2/2", { timeout: 6000 });
  await expect(mine).toContainText("1/2");
  await expect(me.getByRole("heading", { name: "Pay with a card" })).toBeVisible();

  // When she saves, the result shows without anyone reloading.
  await dana.getByRole("button", { name: "Save", exact: true }).click();
  await expect(hers).toContainText("Passed", { timeout: 6000 });
  await expect(row).toContainText("Passed", { timeout: 6000 });

  // My own Save shows my result, and it doesn't flick back to In progress afterwards.
  await press(me, "p");
  await me.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mine).toContainText("Passed", { timeout: 6000 });
  await me.waitForTimeout(2500);
  await expect(mine).toContainText("Passed");
  await expect(mine).not.toContainText("In progress");
});
