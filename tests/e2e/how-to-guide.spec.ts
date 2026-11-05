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
  if (!(await panel(page).isVisible())) await page.getByTestId("menu-how-to").first().click();
  const back = panel(page).getByRole("button", { name: "‹ All tasks" });
  if (await back.isVisible()) await back.click();
  await panel(page).getByLabel("Search the How-to guide").fill(task.title);
  await panel(page).getByRole("button", { name: new RegExp(`^${task.title}`) }).first().click();
  await expect(panel(page).getByRole("heading", { name: task.title })).toBeVisible();
}

let typed = 0;

/** Does what a step asks to its glowing element, the way a person would. */
async function act(page: Page, el: Locator, name: string) {
  const tag = await el.evaluate((n) => n.tagName);
  if (name === "import-drop") {
    const csv = "Title,Steps,Expected Result\nSign in with email,Type your email,You're signed in\nSign out,Press Sign out,You're signed out\n";
    await el.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  } else if (name === "run-kind") await el.getByRole("button", { name: /^Smoke test/ }).click();
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
 */
async function walk(page: Page, id: string, saves = false) {
  const task = howToById.get(id)!;
  await openTask(page, task);
  const steps = panel(page).getByTestId("how-to-step");
  for (const [i, s] of task.steps.entries()) {
    if (!s.target) continue;
    // The glow carries on from the step before; Show me is only needed to start (or after a text step outside a box).
    // "Showing now": it's glowing already, or will as soon as the page shows the button.
    const show = panel(page).getByRole("button", { name: `Show me step ${i + 1}`, exact: true });
    if ((await show.textContent({ timeout: 20_000 })) !== "Showing now") await show.click({ timeout: 20_000 });
    await expect(glow(page), `${id} step ${i + 1}`).toHaveAttribute("data-howto", s.target, { timeout: 45_000 });
    await expect(glow(page)).toHaveCount(1);
    await expect(page.getByTestId("how-to-tip")).toBeVisible();
    if (s.saves && !saves) return;
    await act(page, glow(page).first(), s.target);
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
