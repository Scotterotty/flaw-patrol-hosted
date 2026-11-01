import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Join right on the bash page (steps strip, area cards in place, old Join address forwards),
// logging always confirms, and Add to it closes the find.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("join on the bash page, log a find, add to it and it closes", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `BJ${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Join ${TAG}`, KEY);

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Join bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();

  // Not in yet: the steps strip with a big Join the bug bash button; empty boxes point to it.
  const strip = page.getByTestId("join-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByText("Pick an area to test")).toBeVisible();
  await expect(page.getByText("Nobody has joined yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to bashing" })).toHaveCount(0);
  const board = page.url();

  // The old Join address lands here with the area cards open.
  await page.goto(`${board.replace(/\?.*$/, "")}/join`);
  await expect(page).toHaveURL(/\/bashes\/[^/]+\?join=1$/);
  await expect(page.getByRole("radiogroup", { name: "Area" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(strip).toBeVisible();

  await strip.getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  await expect(page).toHaveURL(/\/explore$/);

  // Logging a note always says it worked.
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByLabel("What did you find?").fill(`Coupon field is tiny ${TAG}`);
  await page.getByRole("button", { name: "Log note" }).click();
  await expect(page.getByText("Note logged. It's at the top of Live finds.")).toBeVisible();

  // Open it, Add to it: it saves, closes and says so.
  const live = page.getByTestId("live-finds");
  await live.getByRole("button", { name: new RegExp(`Coupon field is tiny ${TAG}`) }).click();
  await expect(live.getByTestId("find-open")).toBeVisible();
  await live.getByLabel("Add to it").fill("Also on phones");
  await live.getByRole("button", { name: "Add to it" }).click();
  await expect(live.getByTestId("find-open")).toHaveCount(0);
  await expect(live.getByTestId("find-done")).toContainText(`Added to "Coupon field is tiny ${TAG}"`);
  await expect(live.getByText("1 added")).toBeVisible();

  // Close closes it too.
  await live.getByRole("button", { name: new RegExp(`Coupon field is tiny ${TAG}`) }).click();
  await live.getByRole("button", { name: "Close", exact: true }).click();
  await expect(live.getByTestId("find-open")).toHaveCount(0);

  // Back on the board: You're in, so the strip is gone and Back to bashing shows.
  await page.goto(board);
  await expect(page.getByTestId("join-strip")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to bashing" })).toBeVisible();
});
