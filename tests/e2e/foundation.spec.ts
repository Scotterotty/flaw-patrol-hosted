import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// One walk through milestone 1: sign in, create a project, write and version a
// case, reuse a shared step, import a CSV, and invite a tester whose role limits
// what they can do. Uses a unique project key so it can run against any database.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `E${run}`;


test("foundation milestone end to end", async ({ page, context }) => {
  // The seed's admin is a workspace admin; fall back to them if the database was seeded.
  await signIn(page, "admin@example.com", "Demo Admin");

  await standaloneProject(page, `E2E ${run}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  // Folder
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByPlaceholder("Folder name").fill("Checkout");
  await page.getByPlaceholder("Folder name").press("Enter");
  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();

  // Shared step with a parameter
  await page.goto(`/p/${KEY}/shared-steps/new`);
  await page.getByLabel("Name").fill("Log in as {{role}}");
  await page.getByLabel("Step 1 action").fill("Sign in as {{role}}");
  await page.getByLabel("Step 1 expected result").fill("{{role}} home page");
  await page.getByRole("button", { name: "Add them" }).click();
  await page.getByRole("button", { name: "Create shared step" }).click();
  await expect(page.getByText("Used in 0 cases")).toBeVisible();

  // Case using it
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Pay with saved card");
  await page.getByLabel("Folder").selectOption({ label: "Checkout" });
  await page.getByLabel("Priority").selectOption("CRITICAL");
  await page.getByLabel("Tags").fill("smoke,");
  await page.getByLabel("Step 1 action").fill("Open the cart");
  await page.getByLabel("Step 1 expected result").fill("Cart shows items");
  await page.getByRole("button", { name: "+ Insert shared step" }).click();
  await page.getByRole("button", { name: /Log in as/ }).click();
  // The picker shows every step first and fills the blanks before they go in.
  const picker = page.getByRole("dialog", { name: "Insert shared step" });
  await picker.getByPlaceholder("value").fill("admin");
  await expect(picker.getByText("Sign in as admin")).toBeVisible();
  await picker.getByRole("button", { name: /^Add \d+ steps? at the end/ }).click();
  await expect(page.getByText(/Your other steps didn't change/)).toBeVisible();
  await page.getByRole("button", { name: "Create case" }).first().click();

  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases/1$`));
  await expect(page.getByRole("heading", { name: "Pay with saved card" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sign in as admin" })).toBeVisible();
  await expect(page.getByText("Version 1")).toBeVisible();

  // Edit makes version 2 and the diff shows it
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Step 1 expected result").fill("Cart shows 2 items");
  await page.getByLabel("What changed?").fill("Clarified count");
  await page.keyboard.press("Control+s");
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases/1$`));
  await page.getByRole("link", { name: "Version 2" }).click();
  await expect(page.getByText("Changes from version 1")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cart shows 2 items" })).toBeVisible();

  // Editing the shared step updates the case
  await page.goto(`/p/${KEY}/shared-steps`);
  await page.getByRole("link", { name: /Log in as/ }).click();
  await expect(page.getByText("Used in 1 case")).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  await page.getByLabel("Step 1 action").fill("Sign in with SSO as {{role}}");
  await page.getByRole("button", { name: "Save new version" }).first().click();
  await expect(page).not.toHaveURL(/\/edit$/);
  await page.goto(`/p/${KEY}/cases/1`);
  await expect(page.getByRole("cell", { name: "Sign in with SSO as admin" })).toBeVisible();

  // CSV import, one-row-per-step layout
  await page.goto(`/p/${KEY}/import`);
  const csv = [
    "Title,Section,Priority,Steps,Expected Result",
    '"Coupon applies",Checkout / Discounts,High,"Enter SAVE10","10% off"',
    ',,,"Remove coupon","Full price"',
    '"Gift card",Checkout,Low,"1. Enter card\n2. Apply","1. Accepted\n2. Balance shown"',
  ].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("Preview: 2 cases, 4 steps")).toBeVisible();
  // ver_91: the file's own folders are the default when it has a Folder column.
  await expect(page.getByLabel("Make folders from the file's Folder column")).toBeChecked();
  await expect(page.getByRole("list", { name: "Folders this import makes" })).toContainText("Discounts");
  await page.getByRole("button", { name: "Import 2 cases" }).click();
  await expect(page.getByText("Imported 2 test cases")).toBeVisible();
  await page.goto(`/p/${KEY}/cases?q=coupon`);
  await expect(page.getByRole("link", { name: "Coupon applies" })).toBeVisible();
  await expect(page.getByText("Checkout / Discounts")).toBeVisible();

  // Invite a tester; with open permissions (ver_96) testers can edit and import cases
  await page.goto(`/p/${KEY}/settings`);
  const testerEmail = `tester-${run.toLowerCase()}@example.com`;
  await page.getByLabel("Add someone by email").fill(testerEmail);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(testerEmail, { exact: true })).toBeVisible();

  await context.clearCookies();
  await signIn(page, testerEmail, "New Tester");
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByRole("link", { name: "New case" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import" })).toBeVisible();
  const res = await page.goto(`/p/${KEY}/import`);
  expect(res?.status()).toBe(200);
});

test("uninvited people can't sign in", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(`stranger-${run.toLowerCase()}@nowhere.test`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("hasn't been invited yet")).toBeVisible();
});
