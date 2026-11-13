import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { howToById, type HowToTask } from "../../src/lib/how-to";
import { signIn } from "./auth";

// How-to guide (Scott, Nov 4 2026): How-to guide under Settings in the left menu, with a NEW tag.
// A docked panel that pushes the page over, never opens by itself, and opens from "how do I" in
// Search. Show me makes the step's button glow; clicking it goes on to the next step.
// The walk below presses Show me through every task that has it, so a renamed or removed button
// fails here (the unit test in src/lib/how-to.test.ts checks the names are in the code too).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `HT${TAG}`;
const NAME = `Guide ${TAG}`;
const ids = { group: "" };

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const group = await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web" }] } });
    ids.group = group.id;
    await db.project.update({ where: { id: hub.id }, data: { groupId: group.id } });
    await db.project.create({ data: { key: `HW${TAG}`, name: `${NAME} Web 1.0`, groupId: group.id, platform: "Web", members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
});

const panel = (page: Page) => page.getByTestId("how-to-guide");
const glow = (page: Page) => page.locator(".fp-howto-glow");

/** Opens a task in the guide, from wherever it is. */
async function openTask(page: Page, task: HowToTask) {
  // Close any box left open, so the menu and the guide can be clicked.
  for (let n = 0; n < 3 && (await page.locator("dialog[open]").count()); n++) await page.keyboard.press("Escape");
  // Right after a page change the guide can be missing for a moment and then come back open by itself,
  // so a click then closes it again. Click until it stays open.
  await expect(async () => {
    if (!(await panel(page).isVisible())) await page.getByTestId("menu-how-to").first().click();
    await expect(panel(page)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const back = panel(page).getByRole("button", { name: "‹ All tasks" });
  if (await back.isVisible()) await back.click();
  await panel(page).getByLabel("Search the How-to guide").fill(task.title);
  await panel(page).getByRole("button", { name: new RegExp(`^${task.title}`) }).first().click({ timeout: 20_000 });
  await expect(panel(page).getByRole("heading", { name: task.title })).toBeVisible();
}

let typed = 0;

/** Does what a step asks to its glowing element, the way a person would. */
async function act(page: Page, el: Locator, name: string, task = "") {
  const tag = await el.evaluate((n) => n.tagName);
  const type = await el.evaluate((n) => (n instanceof HTMLInputElement ? n.type : ""));
  if (name === "import-drop") {
    const csv = "Title,Steps,Expected Result\nSign in with email,Type your email,You're signed in\nSign out,Press Sign out,You're signed out\n";
    await el.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  } else if (name === "run-kind") await el.getByRole("button", { name: task === "release-candidate" ? /^Release candidate/ : /^Smoke test/ }).click();
  // ver_175: the rest of the tasks.
  else if (name.startsWith("account-") && tag === "DIV") {
    // A card that folds: open it if it's folded (a click on its open part is enough otherwise).
    const head = el.locator("button[aria-expanded]").first();
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    else await el.locator(":scope > div").last().click({ position: { x: 2, y: 2 } });
  } else if (name === "settings-roles") {
    const head = el.locator("button[aria-expanded]").first();
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    else await el.locator(":scope > div").last().click({ position: { x: 2, y: 2 } });
  } else if (name === "arrange-reset") {
    // Reset is only on once the order changed: move a link with the keyboard first.
    await page.locator('[data-howto="arrange-grip"]').nth(1).focus();
    await page.keyboard.press("ArrowDown");
    await expect(el).toBeEnabled();
    await el.click();
  } else if (name === "case-insert-shared") {
    await el.click();
    // The Insert shared step box; close it to carry on with the next step, which is on the page.
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
  } else if (name === "cases-filters") {
    // Picking a filter is the step: a priority here.
    await el.getByRole("combobox").first().selectOption({ index: 1 });
  } else if (name === "cases-move") await el.selectOption({ index: 1 });
  else if (name === "run-assign") await el.selectOption({ index: (await el.locator("option").count()) > 2 ? 2 : 1 });
  else if (name === "case-step" && task === "test-data") {
    await el.fill(`Sign in as {{role}} ${TAG}`);
    await el.press("Tab");
  } else if (type === "checkbox" && (await el.isChecked())) {
    // ver_176: already ticked (the Regression flag starts on). Clicking it is the step; it's never saved here.
    await el.click();
  } else if (type === "checkbox" || type === "radio") await el.check();
  else if (name === "run-what") await el.getByRole("button", { name: /^Whole Case library/ }).click();
  else if (name === "run-where") await el.getByText(/Web 1\.0/).click();
  else if (name === "suite-cases") await el.getByRole("checkbox").first().check();
  else if (name === "runner-status") await el.getByRole("button", { name: "Failed" }).click();
  else if (tag === "INPUT" || tag === "TEXTAREA") {
    await el.fill(`How-to ${name} ${TAG} ${++typed}`);
    // Enter adds an area; everywhere else, leaving the box is "done".
    await el.press(name === "bash-areas" ? "Enter" : "Tab");
  } else if (tag === "SELECT") await el.selectOption({ index: 0 });
  else if (tag === "BUTTON" || tag === "A") await el.click();
  // A group of choices or a card: a click on it (not on a choice inside) is enough to move on.
  else await el.click({ position: { x: 3, y: 3 } });
}

/**
 * Walks a task with Show me: every step with a button must glow, and doing the step must move the
 * guide on. Steps that save are pressed only when `saves` says so; the walk stops at the first one that isn't.
 * `from` and `to` (step numbers, from 1) walk part of a task: steps outside need data the test doesn't
 * have, like Jira. The `to` step only has to glow.
 */
async function walk(page: Page, id: string, saves = false, { from = 1, to = 0 }: { from?: number; to?: number } = {}) {
  const task = howToById.get(id)!;
  await openTask(page, task);
  const steps = panel(page).getByTestId("how-to-step");
  for (const [i, s] of task.steps.entries()) {
    if (!s.target || i + 1 < from) continue;
    if (to && i + 1 > to) return;
    // The glow carries on from the step before; Show me is only needed to start (or after a text step outside a box).
    // "Showing now": it's glowing already, or will as soon as the page shows the button.
    const show = panel(page).getByRole("button", { name: `Show me step ${i + 1}`, exact: true });
    if ((await show.textContent({ timeout: 20_000 })) !== "Showing now") await show.click({ timeout: 20_000 });
    await expect(glow(page), `${id} step ${i + 1}`).toHaveAttribute("data-howto", s.target, { timeout: 45_000 });
    await expect(glow(page)).toHaveCount(1);
    await expect(page.getByTestId("how-to-tip")).toBeVisible();
    if ((s.saves && !saves) || i + 1 === to) return;
    await act(page, glow(page).first(), s.target, id);
    if (i + 1 < task.steps.length) await expect(steps.nth(i + 1), `${id}: step ${i + 1} moves on`).toHaveAttribute("aria-current", "step");
    else await expect(panel(page).getByTestId("how-to-done")).toBeVisible();
  }
}

test("the How-to guide: NEW in the menu, a panel beside the page, and how do I in Search", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);
  await expect(panel(page)).toHaveCount(0);
  const link = page.getByTestId("menu-how-to").first();
  await expect(link).toContainText("How-to guide");
  await expect(link).toContainText("NEW");

  // It pushes the page over instead of covering it.
  await link.click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Write tests" })).toBeVisible();
  const main = await page.locator("main").first().boundingBox();
  const box = await panel(page).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(main!.x + main!.width - 1);
  await expect(panel(page).getByText("Admins").first()).toBeVisible();

  // It stays closed after a reload once closed, and never opens by itself.
  await panel(page).getByRole("button", { name: "Close the How-to guide" }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("menu-how-to").first()).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  // "how do I" in Search opens the task.
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog");
  await search.getByRole("combobox").or(search.getByRole("searchbox")).or(search.locator("input")).first().fill("how do I write a bug");
  await expect(search.getByTestId("search-how-to")).toContainText("Write a bug");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { name: "Write a bug" })).toBeVisible();
  await expect(panel(page).getByTestId("how-to-step").first()).toContainText("You should see");
  await expect(panel(page).getByRole("button", { name: /^Start a bug bash/ })).toHaveCount(0);
});

test("Show me finds every button, glowing, and clicking it goes to the next step", async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);

  await walk(page, "find-your-way");
  await walk(page, "search");
  // Esc stops the glow.
  await openTask(page, howToById.get("appearance")!);
  await panel(page).getByRole("button", { name: "Show me step 1", exact: true }).click({ timeout: 20_000 });
  await expect(glow(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(glow(page)).toHaveCount(0);
  await walk(page, "appearance");
  // These save, so the walks after them have a case, a suite and a run to work with.
  await page.goto(`/g/${ids.group}`);
  await walk(page, "write-case", true);
  await expect(page.getByText("Version history")).toBeVisible({ timeout: 60_000 });
  await walk(page, "make-suite", true);
  await expect(page).not.toHaveURL(/suites\/new/, { timeout: 60_000 });
  await walk(page, "create-run", true);
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });
  await walk(page, "test-case");
  await walk(page, "report-bug", true);
  await walk(page, "write-bug");
  await walk(page, "start-bash");
  await walk(page, "reports");
  await walk(page, "invite");
  await walk(page, "import-cases");
});

// ver_175: Show me on the rest of the tasks. Each one walks as far as the test's umbrella allows
// (no Jira, GitHub, live bug bash or screen sharing here); the unit test checks every name is in the code.
test("Show me on the rest of the tasks", async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);
  // Something to work with: a case with two steps, a run with a failed case.
  await walk(page, "write-case", true);
  await expect(page.getByText("Version history")).toBeVisible({ timeout: 60_000 });
  await walk(page, "create-run", true);
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });
  await walk(page, "test-case", true);

  await page.goto(`/g/${ids.group}`);
  await walk(page, "profile");
  await walk(page, "accessibility");
  await walk(page, "whats-new");
  await page.goto(`/g/${ids.group}`);
  await walk(page, "arrange-menu");
  await walk(page, "edit-case", true, { to: 6 });
  await expect(page).not.toHaveURL(/\/edit/, { timeout: 60_000 });
  await walk(page, "folders-tags");
  await walk(page, "shared-steps", true);
  await walk(page, "test-data", false, { to: 7 });
  await walk(page, "charters", false, { to: 5 });
  await walk(page, "requirements", false, { to: 1 });
  await walk(page, "glossary", false, { from: 4 });
  await walk(page, "flag-case", true);
  await walk(page, "assign-cases");
  await walk(page, "retest", false);
  await walk(page, "close-run", false);
  await walk(page, "google-sheet", false);
  await walk(page, "automated-results", false, { to: 4 });
  await walk(page, "release-candidate", false, { to: 5 });
  await walk(page, "find-bugs", false, { to: 3 });
  // ver_211: the Board needs Jira, which this umbrella has none of; tests/e2e/ver211.spec.ts covers it.
  await walk(page, "bug-board", false, { to: 1 });
  // ver_232: picks need Jira too; tests/e2e/ver232.spec.ts covers them.
  await walk(page, "bugs-pick", false, { to: 1 });
  await walk(page, "custom-report", false, { to: 3 });
  await walk(page, "bug-templates", false);
  await walk(page, "alerts", false, { to: 5 });
  await walk(page, "roles", false);
  await walk(page, "connect-jira", false);
  await walk(page, "connect-github", false);
  await walk(page, "tools");
  await walk(page, "add-cycle", false);
  await walk(page, "archive", false, { to: 2 });
});

// ver_176 (Scott, Nov 5 2026): every feature in Flaw Patrol has a How-to task. These are the ones added then.
// Steps that need Jira, Sentry, Qase, a teammate or a planned bash only have to glow.
test("Show me on the tasks for every other feature", async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${ids.group}`);
  await walk(page, "write-case", true);
  await expect(page.getByText("Version history")).toBeVisible({ timeout: 60_000 });
  await walk(page, "create-run", true);
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 60_000 });

  await walk(page, "send-feedback");
  await walk(page, "jira-account");
  await walk(page, "radio", false, { to: 4 });
  await page.goto(`/g/${ids.group}`);
  await walk(page, "bulk-edit-cases", false, { to: 5 });
  await walk(page, "personas", true);
  await walk(page, "charter-reminders");
  await walk(page, "update-run-sheet", false, { to: 4 });
  await page.goto(`/g/${ids.group}`);
  // ver_203: Change or delete a run (7 steps, Delete only glows), then the new Import / Export task.
  await walk(page, "edit-run", true, { to: 7 });
  await walk(page, "run-import-export", false, { to: 4 });
  await walk(page, "take-over", false, { to: 3 });
  await walk(page, "regression", false, { to: 4 });
  await walk(page, "schedule-bash", false, { to: 1 });
  await walk(page, "saved-views");
  // ver_182: the bugs on each Release status card.
  await walk(page, "release-bugs", false, { to: 2 });
  await walk(page, "requirements-report", false, { to: 1 });
  await walk(page, "member-roles", false, { to: 3 });
  await walk(page, "run-fields");
  await walk(page, "run-kinds");
  await walk(page, "requirements-settings", false, { to: 1 });
  await walk(page, "media-files", false, { to: 3 });
  await walk(page, "sentry", false, { to: 4 });
  await walk(page, "qase", false, { to: 4 });
  await walk(page, "workspace");
  await walk(page, "workspace-admins", false, { to: 3 });
  // ver_189: runs are named by their version; Version sits up front in Create a run.
  await walk(page, "run-version", false, { to: 5 });
});
