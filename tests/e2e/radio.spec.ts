import { expect, test } from "@playwright/test";
import { signIn, openAccount } from "./auth";

test("the radio is off until someone turns it on, and stays with them", async ({ page }) => {
  await signIn(page, "lead@example.com", "QA Lead");
  await openAccount(page);
  // Start from off, in case an earlier run stopped halfway.
  await page.getByLabel("Show the radio player").uncheck();
  await page.waitForTimeout(500);
  await page.reload();
  const player = page.getByRole("region", { name: "Radio" });
  await expect(player).toHaveCount(0);

  await page.getByLabel("Show the radio player").check();
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: "Play" })).toBeVisible();
  await player.getByLabel("Station").selectOption("groovesalad");
  await page.waitForTimeout(500);
  // somafm.com may be unreachable from CI; answer for it.
  await page.context().route("https://somafm.com/**", (r) => r.fulfill({ body: "SomaFM" }));
  await page.context().route("https://www.kkjz.org/**", (r) => r.fulfill({ body: "KJAZZ" }));
  await page.context().route("https://www.pandora.com/**", (r) => r.fulfill({ body: "Pandora" }));
  const popup = page.waitForEvent("popup");
  await player.getByRole("button", { name: "Play" }).click();
  expect((await popup).url()).toContain("somafm.com/groovesalad");
  // While the station's window is open the button stops it, and it turns back to Play once the window closes.
  await expect(player.getByRole("button", { name: "Stop" })).toBeVisible();
  await (await popup).close();
  await expect(player.getByRole("button", { name: "Play" })).toBeVisible();
  await player.getByLabel("Station").selectOption("kjazz");
  const jazz = page.waitForEvent("popup");
  await player.getByRole("button", { name: "Play" }).click();
  const jazzWindow = await jazz;
  expect(jazzWindow.url()).toContain("kkjz.org");
  await player.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => jazzWindow.isClosed()).toBe(true);
  await player.getByLabel("Station").selectOption("pandora");
  const pandora = page.waitForEvent("popup");
  await player.getByRole("button", { name: "Play" }).click();
  expect((await pandora).url()).toContain("pandora.com");
  await (await pandora).close();
  await player.getByLabel("Station").selectOption("groovesalad");
  await page.waitForTimeout(500);

  // It's docked in the top bar, out of the way of the page.
  await expect(page.locator("header").getByRole("region", { name: "Radio" })).toBeVisible();

  // Spotify links play in Spotify's own player inside the radio.
  await page.context().route("https://open.spotify.com/**", (r) => r.fulfill({ contentType: "text/html", body: "<p>Spotify player</p>" }));
  await page.getByLabel("Spotify link").fill("https://example.com/not-spotify");
  await page.getByRole("button", { name: "Add to radio" }).click();
  await expect(page.getByText("That isn't a Spotify playlist")).toBeVisible();
  await page.getByLabel("Spotify link").fill("https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ?si=e2e");
  await page.getByRole("button", { name: "Add to radio" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toBeVisible();
  await expect(player.getByLabel("Station")).toHaveValue("spotify:playlist:37i9dQZF1DWZeKCadgRdKQ");
  await expect(player.getByText("Playlist · Spotify")).toBeVisible();
  // Located by CSS, since a hidden panel drops out of the accessibility tree.
  const panel = page.locator('[aria-label="Spotify player"]');
  const frame = panel.locator("iframe");
  // Spotify's API is stubbed out here, so the plain player stands in.
  await expect(frame).toHaveAttribute("src", "https://open.spotify.com/embed/playlist/37i9dQZF1DWZeKCadgRdKQ?utm_source=generator");
  await player.getByRole("button", { name: "Hide Spotify player" }).click();
  await expect(frame).toBeHidden();
  await expect(frame).toHaveCount(1); // still loaded, so the music keeps playing
  await player.getByRole("button", { name: "Show Spotify player" }).click();
  await expect(frame).toBeVisible();
  // The same player carries on when moving to another page.
  await frame.evaluate((f) => f.setAttribute("data-same", "yes"));
  await page.locator("header").getByRole("link", { name: /Flaw Patrol/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(frame).toHaveAttribute("data-same", "yes");
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Your account" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(frame).toHaveAttribute("data-same", "yes");
  await panel.getByRole("button", { name: "Stop" }).click();
  await expect(frame).toHaveCount(0);
  await page.getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await page.reload();
  await expect(player.getByLabel("Station")).toHaveValue("fluid");
  // Wait for the choice to be saved before leaving the page.
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), player.getByLabel("Station").selectOption("groovesalad")]);

  // Still there on other pages, with the station remembered.
  await page.goto("/");
  await expect(player.getByLabel("Station")).toHaveValue("groovesalad");

  await openAccount(page);
  await page.getByLabel("Show the radio player").uncheck();
  await expect(player).toHaveCount(0);
  await page.reload();
  await expect(player).toHaveCount(0);
});
