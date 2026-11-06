import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { openReleaseBox, pickKind } from "./projects";

// ver_118: an umbrella with no suites (or no cases at all) never leaves you stuck. New platforms in the
// release box pick test cases like the others, Create a run explains what to do, and the setup card offers
// Make a suite (optional).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

async function newUmbrella(page: Page, name: string, key: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const make = page.getByRole("dialog");
  await make.getByLabel("Product name").fill(name);
  await make.getByLabel("Key").fill(key);
  await make.getByTestId("u-more").click();
  await make.getByLabel("Release", { exact: true }).fill("5.0");
  await make.getByLabel("Platform 1").fill("Web");
  await make.getByRole("button", { name: `Make ${name} with 1 new test cycle` }).click();
  await expect(page).toHaveURL(/\/g\//);
  return page.url();
}

test("no cases and no suites: setup card, release box and Create a run", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const NAME = `Empty ${TAG}`;
  const HUB = `EM${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, NAME, HUB);

  // Start here (ver_178): Run your first tests is step 2; Make a suite (optional) comes after Jira.
  const steps = page.locator("ol").filter({ hasText: "Make a suite (optional)" }).locator("li");
  await expect(steps.nth(1)).toContainText("Run your first tests");
  await expect(steps.nth(2)).toContainText("Invite your team");
  await expect(steps.nth(2).getByTestId("setup-roles-first")).toHaveAttribute("href", /\/settings#roles$/);
  await expect(steps.nth(4)).toContainText("Make a suite (optional)");
  await expect(steps.nth(4).getByRole("link", { name: "Make a suite" })).toHaveAttribute("href", `/p/${HUB}/suites/new`);
  // No cards repeating the left menu, and no shortcuts before the first run.
  await expect(page.getByText("Shortcuts", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Groups of cases you run together")).toHaveCount(0);

  // Create a run: no cases, so one note with links instead of "All 0 active cases".
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  const none = box.getByTestId("run-no-cases");
  await expect(none).toContainText("There are no test cases here yet");
  await expect(none.getByRole("link", { name: /Write the first case/ })).toHaveAttribute("target", "_blank");
  await expect(box.getByRole("button", { name: /Whole Case library/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Release box: a plain note, the platform's picker says None yet, and Start works with No runs yet.
  await page.goto(home);
  await openReleaseBox(page);
  const rc = page.getByRole("dialog");
  await expect(rc.getByTestId("rc-no-cases")).toContainText(`${NAME} has no test cases yet`);
  await rc.getByRole("checkbox", { name: "Web", exact: true }).check();
  const menu = rc.getByRole("group", { name: "Pick test cases for Web" });
  await expect(menu.getByTestId("no-suites-yet")).toContainText("None yet");
  await expect(menu.getByRole("button", { name: /Pick cases…/ })).toBeDisabled();
  await menu.getByRole("button", { name: /No runs yet/ }).click();
  // A new platform starts on No runs yet when there are no cases.
  await rc.getByRole("button", { name: "＋ New platform" }).click();
  await rc.getByLabel("Platform name").fill("Android");
  await expect(rc.getByRole("button", { name: "Test cases for Android" })).toContainText("No runs yet");
  await rc.getByLabel("Release", { exact: true }).fill("6.0");
  const todo = rc.getByTestId("rc-todo");
  await expect(todo).toContainText("Platforms: Web and Android");
  await rc.getByRole("button", { name: "Start 6.0 · 2 platforms" }).click();
  await expect(rc).toHaveCount(0);
  const db = new PrismaClient();
  try {
    const made = await db.project.findMany({ where: { rcName: "6.0", group: { hub: { key: HUB } } }, select: { platform: true } });
    expect(made.map((p) => p.platform).sort()).toEqual(["Android", "Web"]);
  } finally {
    await db.$disconnect();
  }
});

test("cases but no suites: a new platform picks cases from folders, and Create a run offers Pick cases instead", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const NAME = `Nosu ${TAG}`;
  const HUB = `NS${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  const home = await newUmbrella(page, NAME, HUB);
  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByLabel("Title").fill(`Sign in ${TAG}`);
  await page.getByLabel("Step 1 action").fill("Open the app");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: `Sign in ${TAG}` })).toBeVisible();

  // Create a run → A suite: the note explains, and Pick cases instead switches over.
  await page.goto(home);
  await page.getByRole("button", { name: /Create a run/ }).first().click();
  const box = page.getByRole("dialog");
  await pickKind(page);
  await expect(box.getByRole("button", { name: /A suite/ })).toContainText("None yet");
  await box.getByRole("button", { name: /A suite/ }).click();
  const note = box.getByTestId("run-no-suites");
  await expect(note).toContainText("A suite is a saved list of cases");
  await expect(note.getByRole("link", { name: /Make a suite/ })).toHaveAttribute("href", `/p/${HUB}/suites/new`);
  await note.getByRole("button", { name: "Pick cases instead" }).click();
  await expect(box.getByRole("button", { name: /Pick cases/ })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // Release box: a brand-new platform (no suites anywhere) picks its cases from folders.
  await page.goto(home);
  await openReleaseBox(page);
  const rc = page.getByRole("dialog");
  await expect(rc.getByTestId("rc-no-cases")).toHaveCount(0);
  await rc.getByRole("button", { name: "＋ New platform" }).click();
  await rc.getByLabel("Platform name").fill("Switch");
  await expect(rc.getByTestId("rc-todo")).toContainText("Pick test cases for Switch");
  await rc.getByRole("button", { name: "Test cases for Switch" }).click();
  const menu = rc.getByRole("group", { name: "Pick test cases for Switch" });
  await expect(menu.getByTestId("no-suites-yet")).toBeVisible();
  await expect(menu).not.toContainText("Last release");
  await menu.getByRole("button", { name: /Pick cases…/ }).click();
  const tree = rc.getByRole("group", { name: "Choose Switch's cases" });
  await tree.getByRole("checkbox", { name: new RegExp(`Sign in ${TAG}`) }).first().check();
  await tree.getByRole("button", { name: "Done" }).click();
  // The library has only this one case, so picking it is the whole Case library (ver_178 names it so).
  await expect(rc.getByRole("button", { name: "Test cases for Switch" })).toContainText("Whole Case library · 1 case");
  await rc.getByLabel("Release", { exact: true }).fill("6.0");
  await rc.getByRole("button", { name: "Start 6.0 · 1 platform" }).click();
  await expect(page).toHaveURL(/\/runs$/);
});
