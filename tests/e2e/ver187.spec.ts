import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { pickKind } from "./projects";
import { openFilters } from "./filters";

// ver_187: day-one fixes from the ver_185 usability audit.
// 1. An invite opens the umbrella you were added to, with a welcome line; New umbrella is for Admins and Leads.
// 2. Members get their own three-step Start here, which hides after their first saved result.
// 4. The quest-map offer waits for the first result, as a plain link.
// 5. The runner's main button is Save and next all the way, then Save and finish.
// 6. Reports: the summary line first, filters behind one Filter button.
// 7. Plainer words: "of cases tested", "Run these before? Say so", "Tested by".
// 8. New umbrella asks for a name; the rest is under More options.
// 9. Run names get "Nov 5", not "2026-11-05".
// 10. Write a bug has no Template row when there's only one template.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `DO${TAG}`;
const CYCLE = `DW${TAG}`;
const NAME = `Day one ${TAG}`;
const INV = `nina.${TAG.toLowerCase()}@example.com`;
const ids = { group: "", hub: "", admin: "", cycle: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    ids.admin = admin.id;
    const hub = await db.project.create({ data: { key: HUB, name: NAME, caseSeq: 2, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    ids.hub = hub.id;
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    ids.cycle = (await db.project.create({ data: { key: CYCLE, name: `${NAME} Web 1.0`, groupId: group.id, platform: "Web", rcName: "1.0", runSeq: 0, members: { create: { userId: admin.id, role: "ADMIN" } } } })).id;
    for (const [i, title] of ["Add to cart", "Check out"].entries())
      await db.testCase.create({ data: { projectId: hub.id, number: i + 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "MEDIUM", type: "MANUAL", tags: [], steps: [{ kind: "step", action: `Do ${title}`, expected: "It works" }] } } } });
  } finally {
    await db.$disconnect();
  }
});

/** Adds a new Member to the umbrella (and so its test cycle, as syncIfHub does) with a one-time invite link, the way Add + Copy invite link does. */
async function inviteLink() {
  const db = new PrismaClient();
  try {
    const user = await db.user.create({ data: { email: INV, whatsNewSeen: 999, memberships: { create: [{ projectId: ids.hub, role: "TESTER" }, { projectId: ids.cycle, role: "TESTER", fromUmbrella: true }] } } as never });
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await db.passwordLink.create({ data: { userId: user.id, tokenHash, kind: "invite", createdById: ids.admin, expiresAt: new Date(Date.now() + 86_400_000) } });
    return token;
  } finally {
    await db.$disconnect();
  }
}

test("admin: short New umbrella box, run name date, quest offer and Reports filters", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // 8. New umbrella: name and key, the rest folded.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await expect(make.getByLabel("Product name")).toBeVisible();
  await expect(make.getByText("What will you use?")).toHaveCount(0);
  await expect(make.getByText("Make its first test cycles")).toHaveCount(0);
  await make.getByTestId("u-more").click();
  await expect(make.getByText("What will you use?")).toBeVisible();
  await expect(make.getByText("Make its first test cycles")).toBeVisible();
  await page.keyboard.press("Escape");

  // 4. A test cycle with no results: no quest-map offer yet.
  await page.goto(`/p/${CYCLE}`);
  await expect(page.getByText("No runs in progress.")).toBeVisible();
  await expect(page.getByTestId("quest-map-on")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn on quest maps" })).toHaveCount(0);

  // 9. Create a run: the suggested name ends with "Nov 5", not 2026-11-05.
  await page.goto(`/g/${ids.group}`);
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  await expect(box.getByLabel("Run name (optional)")).toHaveAttribute("placeholder", /^Smoke test [A-Z][a-z]{2} \d{1,2}$/);
  await box.getByRole("checkbox", { name: `${NAME} Web 1.0` }).check();
  await box.getByLabel("Release", { exact: true }).fill("1.0");
  await box.getByRole("button", { name: "Create smoke test" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));
  // 7. The run page's words.
  await expect(page.getByText("of cases tested")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run these before? Say so" })).toBeVisible();
});

test("a new Member: invite lands in the umbrella, own Start here, one button name, filters folded", async ({ browser }) => {
  test.setTimeout(240_000);
  const token = await inviteLink();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`/invite/${token}`);
  await p.getByLabel("Your name").fill(`Nina ${TAG}`);
  await p.getByLabel("Choose a password").fill("nina day one 187");
  await p.getByLabel("Confirm password").fill("nina day one 187");
  await p.getByRole("button", { name: "Choose password and sign in" }).click();

  // 1. Straight into the umbrella, with who added you.
  await expect(p).toHaveURL(new RegExp(`/g/${ids.group}\\?welcome=1$`));
  await expect(p.getByTestId("umbrella-hello")).toContainText(`Welcome, Nina. Demo Admin added you to ${NAME}.`);

  // 2. Her own Start here: no Jira or Slack setup.
  const mine = p.getByTestId("member-start-here");
  await expect(mine).toBeVisible();
  await expect(mine.getByText("Open a run and test a case")).toBeVisible();
  await expect(mine.getByText("Report a bug from a failed step")).toBeVisible();
  await expect(p.getByText("Connect Jira")).toHaveCount(0);
  await expect(p.getByText("Send alerts to Slack (optional)")).toHaveCount(0);

  // 1. Members don't get New umbrella.
  await p.goto("/");
  await expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(p.getByRole("button", { name: /New umbrella|Make an umbrella|Make your first umbrella/ })).toHaveCount(0);

  // 5. Start testing: the main button is Save and next, even with one step marked.
  await p.goto(`/g/${ids.group}`);
  await p.getByTestId("member-start-testing").click();
  await expect(p).toHaveURL(/\/runs\/1\/execute/);
  await expect(p.getByRole("button", { name: "Save and next" })).toBeVisible();
  await expect(p.getByText("no steps marked yet")).toBeVisible();
  await expect(p.getByRole("button", { name: "Pick the result yourself" })).toBeVisible();
  await p.getByRole("button", { name: "Passed", exact: true }).first().click();
  await expect(p.getByRole("button", { name: "Save and next" })).toBeVisible();
  await expect(p.getByRole("button", { name: /Save progress and/ })).toHaveCount(0);
  await p.getByRole("button", { name: "Save and next" }).click();
  await expect(p.getByRole("button", { name: "Save and finish" })).toBeVisible();

  // 2. After a saved result, her Start here is gone.
  await p.goto(`/g/${ids.group}`);
  await expect(p.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(p.getByTestId("member-start-here")).toHaveCount(0);

  // 6. Reports: the summary line comes first, the filters open from Filter.
  await p.goto(`/g/${ids.group}/reports`);
  const summary = p.getByTestId("report-summary-line");
  const toggle = p.getByTestId("report-filter-toggle");
  await expect(summary).toBeVisible();
  await expect(toggle).toHaveText(/^Filter/);
  await expect(p.getByLabel("Release", { exact: true })).toBeHidden();
  const [sy, ty] = await Promise.all([summary.boundingBox(), toggle.boundingBox()]);
  expect(sy!.y).toBeLessThan(ty!.y);
  await openFilters(p);
  await expect(p.getByLabel("Release", { exact: true })).toBeVisible();
  await p.getByLabel("Release", { exact: true }).selectOption("1.0");
  await expect(toggle).toHaveText(/Filter \(1\)/);
  // It stays open next time, for this browser.
  await p.reload();
  await expect(p.getByLabel("Release", { exact: true })).toBeVisible();

  // 10. Write a bug with one template: no Template row to read.
  await p.goto(`/g/${ids.group}/bugs?write=1`);
  const wb = p.getByRole("dialog", { name: "Write a bug" });
  await expect(wb.getByLabel("Summary")).toBeVisible();
  await expect(wb.getByTestId("template-picker")).toHaveCount(0);

  // 7. Case library: Tested by.
  await p.goto(`/p/${HUB}/cases`);
  await expect(p.getByLabel("Tested by")).toBeVisible();
  await ctx.close();
});
