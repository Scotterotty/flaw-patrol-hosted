import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_128: each umbrella picks the tools it uses. New umbrella asks "What will you use?", the
// menu, Overview, Reports and Ctrl+K leave out tools that are off, an old link explains and
// offers Turn on, and Settings → Tools changes it later (asking first when a tool has things in it).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Tools ${TAG}`;
const HUB = `T${TAG}`;

test("an umbrella with only Bug bashes and risk, then Test cases turned on and off again", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");

  // New umbrella: Everything is picked; Bug bashes and risk hides the test cycle part.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  const picker = dialog.getByTestId("tool-picker");
  await expect(picker.getByRole("radio", { name: /^Everything/ })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByText("Make its first test cycles")).toBeVisible();
  await picker.getByRole("radio", { name: /^Bug bashes and risk/ }).click();
  await expect(picker).toContainText("Turns on: Bug bashes, Requirements and Risk board.");
  await expect(dialog.getByText("Make its first test cycles")).toHaveCount(0);
  // Pick my own shows a switch per tool, with what each needs.
  await picker.getByRole("radio", { name: /^Pick my own/ }).click();
  await expect(picker.getByRole("switch", { name: "Bug bashes" })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("switch", { name: "Test runs" })).toHaveAttribute("aria-checked", "false");
  await picker.getByRole("radio", { name: /^Bug bashes and risk/ }).click();
  await dialog.getByRole("button", { name: `Make ${NAME}` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();
  const groupId = home.split("/g/")[1].split(/[/?#]/)[0];

  // The menu has only what's on, with + Add tools for an Admin.
  const menu = page.getByRole("navigation", { name: `${NAME} umbrella` }).first();
  await expect(menu.getByRole("link", { name: /^Bug bashes/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^Risk board/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^Bugs/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^Case library/ })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: /^Test runs/ })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "+ Add tools" })).toBeVisible();

  // Overview: Start a bug bash is the button, no test cycles card, bug bash and risk board cards.
  await expect(page.getByRole("button", { name: "▶ Create a run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Start a bug bash/ }).first()).toBeVisible();
  await expect(page.getByText(`Test cycles in ${NAME}`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Risk board/ }).last()).toBeVisible();
  await expect(page.getByText("Start your first bug bash")).toBeVisible();

  // Reports opens on Requirements, and Run reports isn't a tab.
  await menu.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${groupId}/stories`));
  const tabs = page.getByRole("navigation", { name: "Reports" });
  await expect(tabs.getByRole("link", { name: "Requirements" })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Run reports" })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Release status" })).toHaveCount(0);

  // The Umbrellas page says what it uses.
  await page.goto("/");
  await expect(page.getByRole("region", { name: `${NAME} umbrella` }).getByTestId("umbrella-tools")).toHaveText("Bug bashes · Requirements · Risk board");

  // Ctrl+K finds Test suites and says it's off, with Turn on for an Admin.
  await page.goto(home);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" });
  await search.getByRole("combobox").fill("suites");
  const hit = search.getByRole("option", { name: new RegExp(`Test suites is off in ${NAME}`) });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("Part of Test cases.");
  await expect(hit.getByRole("button", { name: "Turn on" })).toBeVisible();
  await page.keyboard.press("Escape");

  // An old link to the Case library explains, and Turn on brings it back.
  await page.goto(`/p/${HUB}/cases`);
  const off = page.getByTestId("tool-off");
  await expect(off.getByRole("heading", { name: `Test cases are off in ${NAME}` })).toBeVisible();
  await expect(off).toContainText("Turn Test cases back on and they're all here again.");
  await off.getByRole("button", { name: "Turn on Test cases" }).click();
  await expect(off).toHaveCount(0);
  await expect(menu.getByRole("link", { name: /^Case library/ })).toBeVisible();

  // Settings → Tools is the first row; Test runs turns Test cases on with it (already on).
  await page.goto(`/g/${groupId}/settings#tools`);
  const panel = page.getByTestId("tools-panel");
  await expect(panel.getByRole("switch", { name: "Test cases" })).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("switch", { name: "Quest map" }).click();
  await expect(panel.getByTestId("tools-note")).toHaveText("Quest map is on. Test runs turned on too, because Quest map needs it.");
  await expect(panel.getByRole("switch", { name: "Test runs" })).toHaveAttribute("aria-checked", "true");

  // A case makes Test cases hold something, so turning it off asks first, and takes what needs it along.
  const db = new PrismaClient();
  try {
    const hub = await db.project.findUniqueOrThrow({ where: { key: HUB } });
    await db.testCase.create({ data: { projectId: hub.id, number: 1, title: `Kept case ${TAG}`, versions: { create: { version: 1, title: `Kept case ${TAG}`, preconditions: "", priority: "MEDIUM", type: "MANUAL", steps: [] } } } });
  } finally {
    await db.$disconnect();
  }
  await page.reload();
  await panel.getByRole("switch", { name: "Test cases" }).click();
  const ask = page.getByRole("dialog", { name: "Turn off Test cases?" });
  await expect(ask).toContainText(`${NAME} has 1 case.`);
  await expect(ask).toContainText("Test runs and Quest map use them, so they turn off too.");
  await ask.getByRole("button", { name: "Keep it on" }).click();
  await expect(panel.getByRole("switch", { name: "Test cases" })).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("switch", { name: "Test cases" }).click();
  await ask.getByRole("button", { name: "Turn off all 3" }).click();
  await expect(panel.getByTestId("tools-note")).toContainText("Test cases are off. Nothing was deleted, just hidden: 1 case.");
  await expect(panel.getByRole("switch", { name: "Quest map" })).toHaveAttribute("aria-checked", "false");

  // The old link says the case is safe.
  await page.goto(`/p/${HUB}/cases/1`);
  await expect(page.getByTestId("tool-off")).toContainText("The 1 case from before is safe.");
});
