import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_127, from the ver_123 functionality audit:
// 3. Moving a test cycle into an umbrella needs Add test cycle on that umbrella, even by calling the action.
// 6. +1 is closed once a bug bash is wrapped up.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
// Fresh people, so the roles given here don't change what the seeded tester sees in other specs.
const MOVER = `mover.${TAG.toLowerCase()}@example.com`;
const PLUSSER = `plusser.${TAG.toLowerCase()}@example.com`;

async function newPerson(email: string, name: string) {
  const db = new PrismaClient();
  try {
    return await db.user.upsert({ where: { email }, create: { email, name, whatsNewSeen: 999 }, update: {} });
  } finally {
    await db.$disconnect();
  }
}

/** Calls a server action by id from the signed-in page, as a crafted request would, and returns what came back. */
const callAction = (page: Page, action: string, args: unknown[]) =>
  page.evaluate(
    async ([action, args]) => {
      const r = await fetch("/", { method: "POST", headers: { "Next-Action": action as string, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(args) });
      return await r.text();
    },
    [action, args] as const,
  );

test("moving a test cycle into an umbrella needs Add test cycle there", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const db = new PrismaClient();
  const ids: Record<string, string> = {};
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const tester = await newPerson(MOVER, `Mover ${TAG}`);
    for (const [name, viewerRole] of [["A", "VIEWER"], ["B", null]] as const) {
      const hub = await db.project.create({
        data: { key: `MU${name}${TAG}`, name: `Move ${name} ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }, ...(viewerRole ? [{ userId: tester.id, role: viewerRole }] : [])] } },
      });
      const group = await db.projectGroup.create({ data: { name: `Move ${name} ${TAG}`, hubProjectId: hub.id } });
      await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
      ids[`hub${name}`] = hub.id;
      ids[`group${name}`] = group.id;
      // A loose test cycle the tester runs as its Admin.
      const loose = await db.project.create({
        data: { key: `ML${name}${TAG}`, name: `Loose ${name} ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: tester.id, role: "ADMIN" }] } },
      });
      ids[`loose${name}`] = loose.id;
    }
  } finally {
    await db.$disconnect();
  }

  // A workspace admin moves Loose B into umbrella B the usual way; the request gives us setProjectGroup's id.
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.groupB}/settings`);
  await page.getByRole("button", { name: /Add test cycle/ }).first().click();
  await page.getByRole("menu").getByRole("button", { name: /^Move in a test cycle/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: new RegExp(`Loose B ${TAG}`) }).check();
  const moved = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("button", { name: `Move into Move B ${TAG}` }).click();
  const moveAction = (await moved).headers()["next-action"];
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The tester is only a Viewer on umbrella A, and not on umbrella B at all: both are refused.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tp = await ctx.newPage();
  await signIn(tp, MOVER, `Mover ${TAG}`);
  expect(await callAction(tp, moveAction, [ids.looseA, ids.groupA])).toContain(`You can't add test cycles to Move A ${TAG}`);
  expect(await callAction(tp, moveAction, [ids.looseA, ids.groupB])).toContain(`You can't add test cycles to Move B ${TAG}`);

  // Made a Tester on umbrella A (Add a test cycle is Tester and up), the same move works.
  const db2 = new PrismaClient();
  try {
    const tester = await newPerson(MOVER, `Mover ${TAG}`);
    expect((await db2.project.findUniqueOrThrow({ where: { id: ids.looseA } })).groupId).toBeNull();
    await db2.projectMember.update({ where: { projectId_userId: { projectId: ids.hubA, userId: tester.id } }, data: { role: "TESTER" } });
    expect(await callAction(tp, moveAction, [ids.looseA, ids.groupA])).toContain('"ok":true');
    expect((await db2.project.findUniqueOrThrow({ where: { id: ids.looseA } })).groupId).toBe(ids.groupA);
  } finally {
    await db2.$disconnect();
  }
  await ctx.close();
});

test("+1 is closed once a bug bash is wrapped up", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const KEY = `PW${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Wrap ${TAG}`, KEY);
  const db = new PrismaClient();
  try {
    const project = await db.project.findUniqueOrThrow({ where: { key: KEY } });
    const tester = await newPerson(PLUSSER, `Plusser ${TAG}`);
    await db.projectMember.create({ data: { projectId: project.id, userId: tester.id, role: "TESTER" } });
  } finally {
    await db.$disconnect();
  }

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Wrap bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page).toHaveURL(/\/bashes\/[^/?]+/);
  const board = page.url().replace(/\?.*$/, "");
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByLabel("What did you find?").fill(`Coupon field is tiny ${TAG}`);
  await page.getByRole("button", { name: "Log note" }).click();
  await expect(page.getByText("Note logged. It's at the top of Live finds.")).toBeVisible();

  // Someone else sees it too while the bash is on; the request gives us plusOneBash's id.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const tp = await ctx.newPage();
  await signIn(tp, PLUSSER, `Plusser ${TAG}`);
  await tp.goto(board);
  await tp.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await tp.getByRole("radio").first().check();
  await tp.getByRole("button", { name: "Start bashing" }).click();
  const live = tp.getByTestId("live-finds");
  await live.getByRole("button", { name: new RegExp(`Coupon field is tiny ${TAG}`) }).click();
  const plused = tp.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await live.getByRole("button", { name: "+1", exact: true }).click();
  const plusAction = (await plused).headers()["next-action"];
  await expect(live.getByRole("button", { name: "✓ You see it too" })).toBeVisible();

  // Wrapped up: taking the +1 back (or adding one) is refused, and the +1 stays as it was.
  const db2 = new PrismaClient();
  try {
    const item = await db2.bashItem.findFirstOrThrow({ where: { text: `Coupon field is tiny ${TAG}` } });
    await db2.bugBash.update({ where: { id: item.bashId }, data: { endedAt: new Date(), wrappedAt: new Date() } });
    expect(await callAction(tp, plusAction, [item.id, false])).toContain("This bash is wrapped up, so +1s are closed.");
    const after = await db2.bashItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(JSON.stringify(after.plusOnes)).toContain(`Plusser ${TAG}`);
  } finally {
    await db2.$disconnect();
  }
  await ctx.close();
});
