import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Hosted build (backend review §4): FUN_FEATURES=off hides the mini game, quest maps and radio
// for everyone, and keeps their data. Needs a server started with E2E_FUN_OFF=1
// (playwright.config.ts then sets FUN_FEATURES=off). Skipped in the normal runs.
test.skip(!process.env.E2E_FUN_OFF, "needs a server started with E2E_FUN_OFF=1");

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `FUN${TAG}`;

test("fun features switched off on the server: hidden for everyone, nothing deleted", async ({ page }) => {
  const db = new PrismaClient();
  try {
    // Someone who had the mini game, quest maps and radio on.
    await db.user.update({ where: { email: "admin@example.com" }, data: { gameEnabled: true, questMap: true, radioEnabled: true } });

    await signIn(page, "admin@example.com", "Demo Admin");
    await standaloneProject(page, `Fun off ${TAG}`, KEY);
    await page.goto(`/p/${KEY}`);
    await expect(page.getByRole("heading", { name: new RegExp(`Fun off ${TAG}`, "i") })).toBeVisible();
    // No radio in the top bar, no Quest map in the menu, no nudge to turn quest maps on.
    await expect(page.getByRole("region", { name: "Radio" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Quest map" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Turn on quest maps" })).toHaveCount(0);

    // Your account: one line in place of the Mini game and Radio cards.
    await page.goto("/account");
    await expect(page.getByTestId("fun-off")).toHaveText("Mini game and radio are switched off on this server.");
    await expect(page.getByRole("button", { name: /^Mini game/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Radio/ })).toHaveCount(0);

    // The account menu has no Mini game item.
    await page.getByTitle(/your account/).click();
    await expect(page.getByRole("menuitem", { name: "Appearance and accessibility" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mini game and quests" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Workspace settings: a line says it's off, and the Game admin section is gone.
    await page.goto("/workspace");
    await expect(page.getByTestId("fun-off-admin")).toContainText("Fun features: off.");
    await expect(page.getByRole("link", { name: "Game admin" })).toHaveCount(0);
    await expect(page.locator("#game-admin")).toHaveCount(0);

    // The pages themselves are Not found.
    expect((await page.request.get("/leaderboard")).status()).toBe(404);
    expect((await page.request.get(`/p/${KEY}/quests`)).status()).toBe(404);

    // The How-to guide leaves out the radio.
    await page.goto(`/p/${KEY}`);
    await page.getByText("How-to guide", { exact: true }).first().click();
    await page.getByPlaceholder("What do you want to do?").fill("radio");
    await expect(page.getByText("Play the radio while you test")).toHaveCount(0);

    // Nothing was deleted: turning the switch back on brings it all back.
    const me = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    expect([me.gameEnabled, me.questMap, me.radioEnabled]).toEqual([true, true, true]);
  } finally {
    await db.user.update({ where: { email: "admin@example.com" }, data: { gameEnabled: false, questMap: false, radioEnabled: false } }).catch(() => {});
    await db.$disconnect();
  }
});
