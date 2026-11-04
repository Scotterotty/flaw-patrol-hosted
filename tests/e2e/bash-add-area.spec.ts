import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_169: whoever started a bash adds an area while it's on, from What's being tested > Edit.
// Everyone sees it with a "New" tag: Finds filter, Join list and Switch area.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();

test("add an area to a live bug bash", async ({ page }) => {
  test.setTimeout(300_000);
  const KEY = `BA${TAG}`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Add area ${TAG}`, KEY);

  await page.goto(`/p/${KEY}/bashes`);
  await page.getByRole("button", { name: /Start a bug bash/ }).first().click();
  const box = page.getByRole("dialog");
  await box.getByLabel("Name").fill(`Area bash ${TAG}`);
  await box.getByLabel("Add an area").fill("Checkout");
  await box.getByLabel("Add an area").press("Enter");
  await box.getByRole("button", { name: "Start bug bash" }).click();
  await box.getByRole("link", { name: "Open the bash" }).click();
  await expect(page.getByTestId("join-strip")).toBeVisible();
  const board = page.url().replace(/\?.*$/, "");

  // Join Checkout so Switch area is there later.
  await page.getByTestId("join-strip").getByRole("button", { name: "Join the bug bash" }).click();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Start bashing" }).click();
  await expect(page).toHaveURL(/\/explore$/);

  await page.goto(board);
  const panel = page.getByTestId("what-youre-testing");
  await panel.getByRole("button", { name: "Edit" }).click();
  const add = panel.getByTestId("add-area");
  await expect(add).toBeVisible();

  // Same name as an area that's there: a plain reason, nothing added.
  await add.getByLabel("Add an area").fill("checkout");
  await add.getByRole("button", { name: "Add area" }).click();
  await expect(add).toContainText("There's already an area called checkout.");

  await add.getByLabel("Add an area").fill("Voice chat");
  await add.getByLabel("Add an area").press("Enter");
  await expect(add.getByLabel("Add an area")).toHaveValue("");
  await expect(panel.getByText("Voice chat", { exact: false })).toBeVisible();
  await expect(panel.getByTestId("new-area-tag")).toHaveCount(1);
  await expect(page.getByText("You started this bash, so you can add areas and change links.")).toBeVisible();

  // The Finds filter has it with New, and the area count went up.
  const chip = page.getByRole("button", { name: /^Voice chat\s*New$/ });
  await expect(chip).toBeVisible();
  await expect(page.getByText("Areas with someone in")).toBeVisible();
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();

  // Switch area offers it, and switching works.
  await page.goto(`${board}/explore`);
  const sw = page.getByLabel("Switch area");
  await expect(sw.locator("option", { hasText: "Voice chat · New" })).toHaveCount(1);
  await sw.selectOption({ label: "Voice chat · New" });
  await expect(page.getByText("Your area").locator("..")).toContainText("Voice chat");
});
