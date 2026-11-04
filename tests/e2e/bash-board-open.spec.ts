import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Click a find on the bash board: it opens in place with everything about it,
// Add to it works there, Copy link's address opens it straight away, Esc closes it.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("open a find on the bug bash board", async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const KEY = `BO${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Board open ${TAG}`, KEY);

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Open bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page.getByTestId("join-strip")).toBeVisible();
  const board = page.url().replace(/\?.*$/, "");

  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByLabel("What did you find?").fill(`Coupon box is tiny ${TAG}`);
  await page.getByRole("button", { name: "Log note" }).click();
  await expect(page.getByText("Note logged. It's at the top of Live finds.")).toBeVisible();

  // On the board: the row is a button; clicking it opens the find in place.
  await page.goto(board);
  const finds = page.getByRole("list", { name: "Finds" });
  const row = finds.getByRole("button", { name: new RegExp(`Coupon box is tiny ${TAG}`) });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const open = finds.getByTestId("find-open");
  await expect(open).toBeVisible();
  await expect(open.getByText("Nothing added yet.")).toBeVisible();
  await expect(open.getByRole("button", { name: "Edit" })).toBeVisible();

  // Add to it from the board: it saves, closes and says so; reopening shows it.
  await open.getByLabel("Add to it").fill(`Also on phones ${TAG}`);
  await open.getByRole("button", { name: "Add to it" }).click();
  await expect(finds.getByTestId("find-open")).toHaveCount(0);
  await expect(page.getByTestId("find-done")).toContainText(`Added to "Coupon box is tiny ${TAG}"`);
  await row.click();
  await expect(open.getByText(`Also on phones ${TAG}`)).toBeVisible();

  // Copy link gives the board address with this find; opening it opens the find.
  await open.getByRole("button", { name: "Copy link" }).click();
  await expect(open.getByRole("button", { name: "Link copied" })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/bashes\/[^/?]+\?find=[^&]+$/);

  // Esc closes it.
  await row.focus();
  await page.keyboard.press("Escape");
  await expect(finds.getByTestId("find-open")).toHaveCount(0);

  await page.goto(link);
  await expect(page.getByRole("list", { name: "Finds" }).getByTestId("find-open")).toBeVisible();
  await expect(page.getByRole("list", { name: "Finds" }).getByText(`Also on phones ${TAG}`)).toBeVisible();
});
