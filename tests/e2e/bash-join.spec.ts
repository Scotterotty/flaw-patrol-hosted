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
  await expect(page.getByTestId("bash-tabs")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Bug bash live · .* · Join/ })).toBeVisible();
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
  await expect(live.getByText("1 note", { exact: true })).toBeVisible();

  // Close closes it too.
  await live.getByRole("button", { name: new RegExp(`Coupon field is tiny ${TAG}`) }).click();
  await live.getByRole("button", { name: "Close", exact: true }).click();
  await expect(live.getByTestId("find-open")).toHaveCount(0);

  // My area / Whole bash tabs (ver_169): the board is one click away, with its find count.
  const tabs = page.getByTestId("bash-tabs");
  await expect(tabs.getByRole("link", { name: "My area · Checkout" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Watch the board" })).toHaveCount(0);
  // In now: the top pill says Back to it and opens your area.
  await expect(page.getByRole("link", { name: /Bug bash live · .* · Back to it/ })).toHaveAttribute("href", /\/explore$/);
  await tabs.getByRole("link", { name: "Whole bash · 1 find" }).click();
  await expect(page).toHaveURL(/\/bashes\/[^/?]+$/);

  // On the board: You're in, so the strip is gone and the tabs show, Whole bash picked.
  await expect(page.getByTestId("join-strip")).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: /Whole bash/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Back to bashing" })).toHaveCount(0);
  await tabs.getByRole("link", { name: "My area · Checkout" }).click();
  await expect(page).toHaveURL(/\/explore$/);
});
