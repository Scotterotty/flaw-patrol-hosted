import { expect, test } from "@playwright/test";
import { signIn, openAccount } from "./auth";

const pick = (page: import("@playwright/test").Page, name: string, value: string) =>
  page.locator("label").filter({ has: page.locator(`input[name="${name}"][value="${value}"]`) });

test("the mini game is opt-in and shows your title next to your name", async ({ page }) => {
  await signIn(page, "lead@example.com", "QA Lead");
  await openAccount(page);
  const join = page.getByLabel("Play the mini game");
  await join.uncheck();
  await expect(page.getByText(/^Level \d+$/)).toHaveCount(0);

  await join.check();
  await expect(page.getByText(/^Level \d+$/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /Cases run/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Cases written/ })).toBeVisible();
  await expect(page.locator('input[name="game-title"][value="guardian"]')).toBeDisabled();

  await pick(page, "game-title", "rookie").click();
  await expect(page.locator("header")).toContainText("Rookie Tester");
  await page.reload();
  await expect(page.locator("header")).toContainText("Rookie Tester");

  // Leaving hides the title again.
  await page.getByLabel("Play the mini game").uncheck();
  await expect(page.locator("header")).not.toContainText("Rookie Tester");
});

test("Early Adopter before launch, and an admin can reset someone's XP", async ({ browser }) => {
  const lead = await browser.newPage();
  await signIn(lead, "lead@example.com", "QA Lead");
  await openAccount(lead);
  await lead.getByLabel("Play the mini game").check();
  await pick(lead, "game-title", "early").click();
  await expect(lead.locator("header")).toContainText("Early Adopter");
  await pick(lead, "game-frame", "fresh").click();
  await expect(lead.locator("header .frame-fresh")).toBeVisible();

  const admin = await browser.newPage();
  await signIn(admin, "admin@example.com", "Demo Admin");
  await admin.goto("/workspace");
  const card = admin.getByRole("region", { name: "Mini game admin" });
  await expect(card).toContainText("Not live yet");
  // Going live takes a deliberate second step: open it, then type GO LIVE.
  await card.getByRole("button", { name: "Go live…" }).click();
  const goLive = card.getByRole("button", { name: "Go live now" });
  await expect(goLive).toBeDisabled();
  await card.getByLabel("Type GO LIVE to confirm").fill("go");
  await expect(goLive).toBeDisabled();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(goLive).toHaveCount(0);

  admin.on("dialog", (d) => d.accept());
  await card.getByRole("button", { name: /Lead's XP/ }).click();
  await expect(card.getByRole("row", { name: /Lead/ })).toContainText(/Reset on \d{4}-\d{2}-\d{2}/);
  await expect(card.getByRole("row", { name: /Lead/ }).getByRole("cell").nth(1)).toHaveText("0");

  // The Early Adopter title and frame survive the reset.
  await lead.reload();
  await expect(lead.locator("header")).toContainText("Early Adopter");
  await expect(lead.locator("header .frame-fresh")).toBeVisible();
  await lead.getByLabel("Play the mini game").uncheck();
});

test("five clicks on 'leaderboard' open the secret leaderboard", async ({ page }) => {
  await signIn(page, "lead@example.com", "QA Lead");
  await openAccount(page);
  await page.getByLabel("Play the mini game").check();
  // Turning the game on refreshes the page; count clicks only after that settles.
  await page.waitForLoadState("networkidle");
  const word = page.getByText("leaderboard", { exact: true });
  for (let i = 0; i < 4; i++) await word.click();
  await expect(page).toHaveURL(/\/account$/);
  await word.click();
  await expect(page).toHaveURL(/\/leaderboard$/);
  await expect(page.getByRole("heading", { name: /Bug of War/ })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "(you)" })).toContainText("XP");
  await openAccount(page);
  await page.getByLabel("Play the mini game").uncheck();
});
