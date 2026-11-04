import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Where bug bash results live: the bash's report is the one home, with four ways in.
// The wrap-up box says so, Past bashes has See results (the whole row opens it too),
// Charters points to Bug bashes once one is wrapped, and Your work lists your own finds.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `BR${TAG}`;
let wrappedId = "";
let endedId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: `Bash results ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const group = await db.projectGroup.create({ data: { name: `Bash results ${TAG}`, hubProjectId: hub.id, rolesChosenAt: new Date() } });
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    const now = Date.now();
    const areas = [{ id: "a1", name: "Checkout", caseId: "none", template: null }];
    const bash = (name: string, startMin: number, wrapped: boolean) =>
      db.bugBash.create({
        data: { projectId: hub.id, name, minutes: 60, startsAt: new Date(now + startMin * 60_000), endsAt: new Date(now + (startMin + 60) * 60_000), areas, createdById: admin.id, createdBy: "Demo Admin", wrappedAt: wrapped ? new Date(now - 60 * 60_000) : null },
      });
    const wrapped = await bash(`Bash the Build ${TAG}`, -3 * 60, true);
    const ended = await bash(`Still open ${TAG}`, -2 * 60, false);
    wrappedId = wrapped.id;
    endedId = ended.id;
    await db.bashPerson.create({ data: { bashId: wrapped.id, userId: admin.id, name: "Demo Admin", areaId: "a1" } });
    await db.bashItem.createMany({
      data: [
        { bashId: wrapped.id, areaId: "a1", kind: "bug", text: `Total wrong after coupon ${TAG}`, byId: admin.id, byName: "Demo Admin" },
        { bashId: wrapped.id, areaId: "a1", kind: "note", text: `Search slow on 3G ${TAG}`, byId: admin.id, byName: "Demo Admin" },
        { bashId: wrapped.id, areaId: "a1", kind: "question", text: `Should guests see saved carts ${TAG}`, byId: admin.id, byName: "Demo Admin" },
        { bashId: wrapped.id, areaId: "a1", kind: "idea", text: `Show coupon savings ${TAG}`, byId: admin.id, byName: "Demo Admin" },
        { bashId: ended.id, areaId: "a1", kind: "note", text: `Ended note ${TAG}`, byId: admin.id, byName: "Demo Admin" },
      ],
    });
  } finally {
    await db.$disconnect();
  }
});

test("the wrap-up box says results stay in the bash's report", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/bashes/${endedId}`);
  await expect(page.getByText("Everything found (bugs, notes, questions and ideas) stays in this bash's report. Find it any time on Bug bashes.")).toBeVisible();
  await expect(page.getByText("saved as their session on the area's charter")).toHaveCount(0);
});

test("Past bashes shows what each bash found and See results opens its report", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/bashes`);
  const row = page.getByTestId("past-bash").filter({ hasText: `Bash the Build ${TAG}` });
  await expect(row).toContainText("1 note · 1 question · 1 idea");
  await row.getByRole("link", { name: `See results of Bash the Build ${TAG}` }).click();
  await expect(page).toHaveURL(new RegExp(`/bashes/${wrappedId}/report$`));

  // The whole row opens it too.
  await page.goto(`/p/${HUB}/bashes`);
  await row.click({ position: { x: 40, y: 12 } });
  await expect(page).toHaveURL(new RegExp(`/bashes/${wrappedId}/report$`));
});

test("Charters points to Bug bashes, and Your work lists your own finds", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/charters`);
  const pointer = page.getByTestId("bash-results-pointer");
  await expect(pointer).toContainText("Bug bash results are on Bug bashes.");
  await pointer.getByRole("link", { name: "Bug bashes" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${HUB}/bashes$`));

  await page.goto("/");
  const mine = page.getByTestId("your-bashes").getByRole("listitem").filter({ hasText: `Bash the Build ${TAG}` });
  await expect(mine).toContainText("you logged 4 finds");
  await mine.getByRole("link", { name: /See results/ }).click();
  await expect(page).toHaveURL(new RegExp(`/bashes/${wrappedId}/report$`));
});
