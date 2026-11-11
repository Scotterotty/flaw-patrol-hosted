import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { openMoreDetails } from "./case-form";
import { pickKind } from "./projects";

// ver_216: first-time experience, part A.
// 3. Start here leads on: Show me on every admin step, Import ends with Next: run these cases,
//    Create a run with no cases waits for cases, a Member with no runs is told who starts one.
// 4. A one-time "You're set" card after your first saved result.
// 5. A line on the sign-in page; the empty workspace's Show me opens Your first 10 minutes.
// 6. Import shows the matched columns, names the unmatched ones, Show all columns has the rest.
// 7. A new case: Title, then Steps, then Folder (prefilled); the rest under More details, remembered.
// 8. Start here: ✕ Hide for now (and Esc), Getting started in the account menu, Show Start here again.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `FT${TAG}`;
const CYCLE = `FW${TAG}`;
const NAME = `First day ${TAG}`;
const MEMBER = `mo.${TAG.toLowerCase()}@example.com`;
const ids = { group: "", hub: "", admin: "", cycle: "", folder: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    ids.admin = admin.id;
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    ids.hub = hub.id;
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    ids.cycle = (await db.project.create({ data: { key: CYCLE, name: `${NAME} Web 1.0`, groupId: group.id, platform: "Web", rcName: "1.0", runSeq: 0, members: { create: { userId: admin.id, role: "ADMIN" } } } })).id;
    ids.folder = (await db.folder.create({ data: { projectId: hub.id, name: "Checkout" } })).id;
    await db.user.create({ data: { email: MEMBER, name: "Mo Member", whatsNewSeen: 999, memberships: { create: [{ projectId: hub.id, role: "TESTER" }, { projectId: ids.cycle, role: "TESTER", fromUmbrella: true }] } } as never });
    // Start fresh: Start here showing and More details closed for the admin.
    const me = await db.user.findUniqueOrThrow({ where: { id: admin.id }, select: { openCards: true } });
    await db.user.update({ where: { id: admin.id }, data: { openCards: me.openCards.filter((w) => !w.startsWith("first:")) } });
  } finally {
    await db.$disconnect();
  }
});

test("sign-in says what Flaw Patrol is", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/signin");
  await expect(p.getByTestId("signin-tagline")).toHaveText("Write tests, run them together and report bugs, all in one place.");
  await ctx.close();
});

test("a Member with no runs is told who starts one", async ({ page }) => {
  await signIn(page, MEMBER, "Mo Member");
  await page.goto(`/g/${ids.group}`);
  const mine = page.getByTestId("member-start-here");
  await expect(mine).toBeVisible();
  await expect(mine.getByTestId("member-no-runs")).toHaveText("No runs yet. Demo Admin will start one.");
  await expect(mine.getByRole("link", { name: "Test runs" })).toHaveCount(0);
  await expect(mine.getByTestId("start-here-hide")).toBeVisible();
});

test("Start here: Show me, Create a run with no cases, Hide for now and bringing it back", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);
  const start = page.getByTestId("admin-start-here");
  await expect(start).toBeVisible();
  await expect(start.getByTestId("admin-show-import-cases")).toBeVisible();
  await expect(start.getByTestId("admin-show-connect-jira")).toBeVisible();

  // Show me opens the How-to guide on that task.
  await start.getByTestId("admin-show-import-cases").click();
  const guide = page.getByTestId("how-to-guide");
  await expect(guide.getByRole("heading", { name: "Import cases from a spreadsheet" })).toBeVisible();
  await guide.getByRole("button", { name: "Close the How-to guide" }).click();

  // Create a run with no cases: the kind question stays, the rest waits for cases.
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  const none = box.getByTestId("run-no-cases");
  await expect(none).toContainText("The rest of this form waits until there are cases.");
  await expect(none.getByRole("link", { name: /Import cases/ })).toBeVisible();
  await expect(box.getByRole("button", { name: /Create smoke test|Create and test now/ })).toHaveCount(0);
  await expect(box.getByText("Test cycle", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ✕ Hide for now: gone, and stays gone after a reload.
  await start.getByTestId("start-here-hide").click();
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
  await expect(page.getByTestId("admin-start-here")).toHaveCount(0);

  // The How-to guide offers it back while it's hidden.
  await page.getByTestId("menu-how-to").first().click();
  // The guide reopens on the last task it showed; the button is on the list of tasks.
  const back = guide.getByRole("button", { name: "‹ All tasks" });
  if (await back.isVisible()) await back.click();
  await expect(guide.getByTestId("howto-start-again")).toBeVisible();
  await guide.getByRole("button", { name: "Close the How-to guide" }).click();

  // Getting started in the account menu brings it back, ticks kept.
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Getting started" }).click();
  await expect(page.getByTestId("admin-start-here")).toBeVisible();

  // Esc inside the list hides it too.
  await page.getByTestId("admin-start-here").getByTestId("admin-show-connect-jira").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("admin-start-here")).toHaveCount(0);
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Getting started" }).click();
  await expect(page.getByTestId("admin-start-here")).toBeVisible();
});

test("a new case: Title, then Steps, then the folder you're in; More details is remembered", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/cases/new`);
  // One folder in the library, so it's picked for you.
  await expect(page.getByLabel("Folder")).toHaveValue(ids.folder);
  const title = await page.getByLabel("Title").boundingBox();
  const step = await page.getByLabel("Step 1 action").boundingBox();
  const folder = await page.getByLabel("Folder").boundingBox();
  expect(step!.y).toBeGreaterThan(title!.y);
  expect(folder!.y).toBeGreaterThan(step!.y);
  // Step 1 is on the first phone screen.
  expect(step!.y + step!.height).toBeLessThan(844);
  await expect(page.getByLabel("Priority")).toHaveCount(0);
  await expect(page.getByLabel("Preconditions")).toHaveCount(0);
  await expect(page.getByLabel("Select step 1")).toHaveCount(0);
  await expect(page.getByTestId("case-tips")).toHaveCount(0);
  await page.getByTestId("case-tips-toggle").click();
  await expect(page.getByTestId("case-tips")).toContainText("becomes a section title");

  await openMoreDetails(page);
  await expect(page.getByLabel("Priority")).toBeVisible();
  await expect(page.getByLabel("Preconditions")).toBeVisible();
  // Left open: open again next time.
  await expect(async () => {
    await page.goto(`/p/${HUB}/cases/new`);
    await expect(page.getByTestId("case-more-details")).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
  }).toPass();
  await page.getByLabel("Title").fill("Pay with a saved card");
  await page.getByLabel("Step 1 action").fill("Press Pay");
  await page.getByLabel("Step 1 expected result").fill("The order is saved");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Pay with a saved card" })).toBeVisible();
  // Put it back for the other specs.
  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByTestId("case-more-details").click();
  await expect(page.getByTestId("case-more-details")).toHaveAttribute("aria-expanded", "false");
});

test("import shows the matched columns, then leads on to a run", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${HUB}/import`);
  const csv = ["Title,Steps,Expected Result,Owner", "Add to cart,Press Add,The cart count goes up,Avery", "Remove from cart,Press Remove,The item leaves the cart,Avery", "Check out,Press Pay,The order is saved,Nina"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "first-day.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("Preview: 3 cases")).toBeVisible();
  await expect(page.getByTestId("import-matched-count")).toHaveText("We matched 3 of your 4 columns.");
  await expect(page.getByTestId("import-not-matched")).toContainText("Not matched: Owner.");
  // Only the matched boxes; the rest wait under Show all columns.
  await expect(page.getByLabel("Title *")).toBeVisible();
  await expect(page.getByLabel("Automation ID")).toHaveCount(0);
  await page.getByTestId("import-show-all-columns").click();
  await expect(page.getByLabel("Automation ID")).toBeVisible();
  await page.getByTestId("import-show-all-columns").click();
  await expect(page.getByLabel("Automation ID")).toHaveCount(0);

  await page.getByLabel("Folder for all cases").selectOption({ label: "Checkout" });
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: /^Import 3 cases/ }).click();
  const next = page.getByTestId("import-next-run");
  await expect(next).toHaveText("Next: run these 3 cases");
  await expect(next).toHaveAttribute("href", `/g/${ids.group}?start=run`);
  await next.click();
  await expect(page.getByRole("dialog", { name: "Create a run" })).toBeVisible();
});

test("the You're set card after a first saved result, once", async ({ page }) => {
  test.setTimeout(180_000);
  const db = new PrismaClient();
  const member = await db.user.findUniqueOrThrow({ where: { email: MEMBER } });
  await db.$disconnect();
  await signIn(page, MEMBER, "Mo Member");
  // A run with the imported cases, assigned to nobody; Mo tests one case.
  await page.goto(`/g/${ids.group}`);
  await expect(page.getByTestId("all-set")).toHaveCount(0);
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  await pickKind(page);
  await page.getByRole("dialog").getByRole("button", { name: /Whole Case library/ }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: `${NAME} Web 1.0` }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Create and test now" }).click();
  await expect(page).toHaveURL(/\/execute/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Passed", exact: true }).first().click();
  await page.getByRole("button", { name: "Save and next" }).click();
  await expect(page.getByRole("button", { name: /Save and (next|finish)/ })).toBeVisible();

  await page.goto(`/g/${ids.group}`);
  const card = page.getByTestId("all-set");
  await expect(card).toContainText("You're set, Mo. First result saved.");
  await expect(card).toContainText("Ctrl + K finds any case, run or bug.");
  // The Members' Start here is done; the run row is honest about 1 case.
  await expect(page.getByTestId("member-start-here")).toHaveCount(0);
  await expect(page.getByTestId("umbrella-runs-in-progress")).toContainText(/1 of \d+ tested · all passed so far/);
  // Esc on the card closes it, for good.
  await card.focus();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(async () => {
    const d = new PrismaClient();
    try {
      const me = await d.user.findUniqueOrThrow({ where: { id: member.id }, select: { openCards: true } });
      expect(me.openCards).toContain("first:set-seen");
    } finally {
      await d.$disconnect();
    }
  }).toPass();
  await page.reload();
  await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
  await expect(page.getByTestId("all-set")).toHaveCount(0);
});

// Readable in every look (4.5:1): Start here, the You're set card, the new case form and the import page.
const RULES = ["color-contrast", "aria-required-attr", "aria-allowed-attr", "label-content-name-mismatch", "link-in-text-block", "heading-order", "target-size"];
const AXE = require.resolve("axe-core/axe.min.js");
const LOOK_IDS = ["classic", "mission", "hc", "white", "blue", "arcade", "retro"];

async function problems(page: import("@playwright/test").Page, within: string) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(
    async ([rules, sel]) => {
      // @ts-expect-error axe is added by the script tag
      const r = await window.axe.run(document.querySelector(sel) ?? document, { runOnly: { type: "rule", values: rules } });
      return r.violations.flatMap((v: { id: string; nodes: { target: string[]; any: { message: string }[] }[] }) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}: ${n.any[0]?.message}`));
    },
    [RULES, within] as const,
  );
}

test("the first-day pieces pass the accessibility checks in every look, light and dark", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const db = new PrismaClient();
  const member = await db.user.findUniqueOrThrow({ where: { email: MEMBER }, select: { id: true, openCards: true } });
  // Show Mo the You're set card again for the check.
  await db.user.update({ where: { id: member.id }, data: { openCards: member.openCards.filter((w) => w !== "first:set-seen") } });
  await signIn(page, MEMBER, "Mo Member");
  try {
    for (const look of LOOK_IDS) {
      for (const theme of ["light", "dark"]) {
        await db.user.update({ where: { id: member.id }, data: { themeMode: theme, look } });
        await page.goto(`/g/${ids.group}`);
        await expect(page.getByTestId("all-set")).toBeVisible();
        expect(await problems(page, "[data-testid=all-set]"), `${look} ${theme} You're set`).toEqual([]);
        await page.goto(`/p/${HUB}/cases/new`);
        await openMoreDetails(page);
        await page.getByTestId("case-tips-toggle").click();
        expect(await problems(page, "main"), `${look} ${theme} new case`).toEqual([]);
      }
    }
    // Start here, as a Member who hasn't saved a result (a second Member) and as the admin.
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" }, select: { id: true, look: true, themeMode: true } });
    const ctx = await browser.newContext();
    const a = await ctx.newPage();
    await signIn(a, "admin@example.com", "Demo Admin");
    try {
      for (const look of LOOK_IDS) {
        for (const theme of ["light", "dark"]) {
          await db.user.update({ where: { id: admin.id }, data: { themeMode: theme, look } });
          await a.goto(`/g/${ids.group}`);
          await expect(a.getByTestId("admin-start-here")).toBeVisible();
          expect(await problems(a, "[data-testid=admin-start-here]"), `${look} ${theme} Start here`).toEqual([]);
        }
      }
    } finally {
      await ctx.close();
      await db.user.update({ where: { id: admin.id }, data: { look: admin.look, themeMode: admin.themeMode } });
    }
  } finally {
    await db.user.update({ where: { id: member.id }, data: { themeMode: "light", look: "classic" } });
    await db.$disconnect();
  }
});
