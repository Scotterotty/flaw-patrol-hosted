import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_111: Save and next saves once, loads the next case once (no second load, no redraw of the
// case you left), and plain Save still reloads the case with its saved result afterwards.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `SN${TAG}`;
const ids: string[] = [];

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 111 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({
      data: { key: KEY, name: `Save next ${TAG}`, caseSeq: 3, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } },
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
        name: "Save and next",
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

const results = async (entryId: string) => {
  const db = new PrismaClient();
  try {
    return await db.testResult.findMany({ where: { entryId }, select: { status: true } });
  } finally {
    await db.$disconnect();
  }
};

/** Marks both steps with the keyboard (P passes, F fails, and moves on to the next step). */
async function mark(page: Page, key: "p" | "f") {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(key);
  await page.keyboard.press(key);
}

test("Save and next saves once and opens the next case with one load", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  // Page loads of a case, leaving out prefetches made for links.
  const loads = new Map<string, number>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() === "GET" && u.searchParams.has("_rsc") && !r.headers()["next-router-prefetch"] && u.pathname.endsWith("/execute")) {
      const e = u.searchParams.get("entry") ?? "";
      loads.set(e, (loads.get(e) ?? 0) + 1);
    }
  });

  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids[0]}`);
  await expect(page.getByRole("heading", { name: "Pay with a card" })).toBeVisible();
  await mark(page, "p");
  // Pressing twice quickly still saves one result.
  const next = page.getByRole("button", { name: "Save and next", exact: true });
  await next.click();
  await next.click({ timeout: 1000 }).catch(() => {});
  await expect(page).toHaveURL(new RegExp(`entry=${ids[1]}`));
  await expect(page.getByRole("heading", { name: "Pay with a voucher" })).toBeVisible();
  // The next case is loaded fresh, so its Run List already counts the case just saved.
  await expect(page.getByText("1 of 3 tested")).toBeVisible();
  expect(await results(ids[0])).toEqual([{ status: "PASSED" }]);
  // The case you left isn't loaded again, and the next one is loaded once.
  expect(loads.get(ids[0]) ?? 0).toBe(0);
  expect(loads.get(ids[1])).toBe(1);

  // Plain Save on the case Save and next opened still reloads it with its saved result.
  await mark(page, "f");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Its step results are shown below. Change anything and save to record a new result.")).toBeVisible();
  expect(await results(ids[1])).toEqual([{ status: "FAILED" }]);

  // And Save and next works again from there.
  await page.getByRole("button", { name: "Save and next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pay with points" })).toBeVisible();
});
