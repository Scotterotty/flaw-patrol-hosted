import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Bug bash build, environment and link: set when starting, shown when joining and while testing,
// changed mid-bash from the board, and carried into each filed bug as it was when logged.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("a bug bash says which build and environment, and each bug keeps its build", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const KEY = `BE${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Bash build ${TAG}`, KEY);

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Build bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  const setup = box.getByTestId("bash-setup");
  await expect(setup).toContainText("What are people testing?");
  await setup.getByLabel("Build").fill("2.4.1 (812)");
  await setup.getByLabel("Environment").fill("Staging");
  await setup.getByLabel("Link").fill("not a link");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await expect(box).toContainText("The link needs to start with http:// or https://");
  await setup.getByLabel("Link").fill("https://staging.example.com/checkout");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page).toHaveURL(/\/bashes\/[^/?]+/);
  const board = page.url().replace(/\?.*$/, "");

  // The board's card shows them.
  const card = page.getByTestId("what-youre-testing");
  await expect(card.getByTestId("bash-setup")).toContainText("Build2.4.1 (812)");
  await expect(card.getByTestId("bash-setup")).toContainText("EnvironmentStaging");

  // Joining: the strip at the top of the area picker.
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  const strip = page.getByTestId("bash-setup-strip");
  await expect(strip).toContainText("Build 2.4.1 (812)");
  await expect(strip).toContainText("Environment Staging");
  await expect(strip.getByRole("link", { name: /Open what we're testing/ })).toHaveAttribute("href", "https://staging.example.com/checkout");
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: /Start bashing/ }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByTestId("what-youre-testing").getByTestId("bash-setup")).toContainText("2.4.1 (812)");

  await page.getByLabel("What did you find?").fill(`Pay button spins ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  const live = page.getByTestId("live-finds");
  await expect(live.locator("li").filter({ hasText: `Pay button spins ${TAG}` })).toBeVisible();

  // A new build drops: the starter changes it on the board.
  await page.goto(board);
  const edit = page.getByTestId("what-youre-testing");
  await edit.getByRole("button", { name: "Edit" }).click();
  await edit.getByLabel("Build").fill("2.4.2");
  await edit.getByRole("button", { name: "Save build and environment" }).click();
  await edit.getByRole("button", { name: "Done" }).click();
  await expect(edit.getByTestId("bash-setup")).toContainText("Build2.4.2");

  // Someone testing sees the change without reloading.
  await page.goto(`${board}/explore`);
  const db = new PrismaClient();
  const bash = await db.bugBash.findFirstOrThrow({ where: { name: `Build bash ${TAG}` }, select: { runId: true } });
  await db.testRun.update({ where: { id: bash.runId! }, data: { build: "2.4.3" } });
  await expect(page.getByTestId("bash-setup-moved")).toContainText("Build changed to 2.4.3.");
  await page.getByTestId("bash-setup-moved").getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("bash-setup-moved")).toHaveCount(0);
  await page.getByLabel("What did you find?").fill(`Total is wrong ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(live.locator("li").filter({ hasText: `Total is wrong ${TAG}` })).toBeVisible();

  const items = await db.bashItem.findMany({ where: { text: { endsWith: TAG } }, orderBy: { createdAt: "asc" } });
  expect(items.map((i) => [i.build, i.environment])).toEqual([
    ["2.4.1 (812)", "Staging"],
    ["2.4.3", "Staging"],
  ]);

  // Wrap up: each bug says the build it was found on, the environment and what was being tested.
  await page.goto(board);
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: "File 2 bugs and wrap up" }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 }).locator("xpath=..")).toContainText("Build 2.4.3 on Staging");
  const first = await db.defect.findFirstOrThrow({ where: { title: `Pay button spins ${TAG}` } });
  expect(first.description).toContain("Build: 2.4.1 (812)\nEnvironment: Staging");
  expect(first.description).toContain("https://staging.example.com/checkout");
  const second = await db.defect.findFirstOrThrow({ where: { title: `Total is wrong ${TAG}` } });
  expect(second.description).toContain("Build: 2.4.3\nEnvironment: Staging");
  await db.$disconnect();
});
