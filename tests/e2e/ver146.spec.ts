import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_146: bug bash platforms. Whoever starts a bash can ask people which platform they're on;
// joining offers it (optional), each find keeps its platform, you can switch it while bashing,
// the board counts people per platform, and the report counts bugs per platform (never people).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("a bug bash that asks which platform people are on", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  const KEY = `BP${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Bash platforms ${TAG}`, KEY);

  // No umbrella platforms and no earlier bash: the row starts off. Turn it on and add two.
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  const plats = box.getByTestId("bash-platforms");
  const ask = plats.getByRole("checkbox", { name: /Ask people which platform/ });
  await expect(ask).not.toBeChecked();
  await ask.check();
  await plats.getByLabel("Add a platform").fill("Web");
  await plats.getByLabel("Add a platform").press("Enter");
  await plats.getByLabel("Add a platform").fill("Unity");
  await plats.getByLabel("Add a platform").press("Enter");
  await box.getByLabel("Name").fill(`Platform bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page.getByTestId("board-platforms")).toContainText("Web · nobody yet");
  const board = page.url().replace(/\?.*$/, "");

  // Join: the area first, then the optional platform question.
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  const which = page.getByTestId("join-platform");
  await expect(which).toContainText("Which platform are you on?");
  await which.getByRole("radio", { name: /^Unity/ }).click();
  await page.getByRole("button", { name: "Start bashing on Unity" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByTestId("your-platform")).toContainText("Unity");
  await expect(page.getByText("Area, platform (Unity), time and your name are filled in for you.")).toBeVisible();

  await page.getByLabel("What did you find?").fill(`Pay button spins ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  const live = page.getByTestId("live-finds");
  await expect(live.locator("li").filter({ hasText: `Pay button spins ${TAG}` })).toContainText("Unity");

  // Switch platform: new finds use it, the first keeps Unity.
  await page.getByLabel("Switch platform").selectOption("Web");
  await expect(page.getByTestId("your-platform")).toContainText("Web");
  await page.getByLabel("What did you find?").fill(`Total is wrong ${TAG}`);
  await page.getByRole("button", { name: "Log bug" }).click();
  await expect(live.locator("li").filter({ hasText: `Total is wrong ${TAG}` })).toContainText("Web");

  const db = new PrismaClient();
  const items = await db.bashItem.findMany({ where: { text: { endsWith: TAG } }, orderBy: { createdAt: "asc" } });
  expect(items.map((i) => i.platform)).toEqual(["Unity", "Web"]);
  // Someone else saw the first one on Web (+1 rows are covered by the unit tests).
  await db.bashItem.update({ where: { id: items[0].id }, data: { plusOnes: [{ id: "someone-else", name: `Raj ${TAG}`, platform: "Web" }] } });

  // Board: one person, on Web now.
  await page.goto(board);
  await expect(page.getByTestId("board-platforms")).toContainText("Web · 1 person");
  await expect(page.getByTestId("board-platforms")).toContainText("Unity · nobody yet");

  // Wrap up: the filed bug gets a [platform] tag, and the report counts bugs per platform.
  await page.getByRole("button", { name: "End early" }).click();
  await page.getByRole("button", { name: "Yes, end it" }).click();
  await page.getByRole("button", { name: "File 2 bugs and wrap up" }).click();
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });
  const table = page.getByTestId("bash-by-platform");
  await expect(table.getByRole("row", { name: /^Web 2 0 1 1$/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /^Unity 1 0 0 1$/ })).toBeVisible();
  const bugs = await db.defect.findMany({ where: { title: { endsWith: TAG } }, orderBy: { number: "asc" } });
  expect(bugs.map((b) => b.title).sort()).toEqual([`[Unity] Pay button spins ${TAG}`, `[Web] Total is wrong ${TAG}`].sort());

  // The next bash offers the same platforms, already on.
  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const again = page.getByRole("dialog").getByTestId("bash-platforms");
  await expect(again.getByRole("checkbox", { name: /Ask people which platform/ })).toBeChecked();
  await expect(again.getByRole("button", { name: "Remove platform Unity" })).toBeVisible();
  await db.$disconnect();
});
