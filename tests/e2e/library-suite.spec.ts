import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject, pickKind } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Lib ${TAG}`;
const HUB = `L${TAG}`;
const RC = `LR${TAG}`;

async function newCase(page: Page, key: string, title: string) {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Step 1 action").fill("Open the app");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("a test cycle's suites, Create a run and reports use the umbrella's Case library", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // A test cycle whose case moves up into a new umbrella's Case library.
  await page.goto("/");
  await standaloneProject(page, `RC ${TAG}`, RC);
  await newCase(page, RC, `Sign in ${TAG}`);
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByRole("checkbox", { name: new RegExp(`^RC ${TAG}`) }).check();
  await dialog.getByRole("button", { name: `Make ${NAME} with 1 moved in` }).click();
  await expect(page).toHaveURL(/\/g\//);
  await newCase(page, HUB, `Checkout ${TAG}`);

  // A shared suite in the library.
  await page.goto(`/p/${HUB}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Shared smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);

  // New suite in the test cycle finds library cases by search, folder menu and key.
  await page.goto(`/p/${RC}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Cycle picks");
  await page.getByLabel("Search cases").fill("Checkout");
  await expect(page.getByText(`Checkout ${TAG}`)).toBeVisible();
  await expect(page.getByText(`Sign in ${TAG}`)).toBeHidden();
  await page.getByLabel("Search cases").fill(`${HUB}-`);
  await expect(page.getByRole("button", { name: "Tick all 2" })).toBeVisible();
  await page.getByLabel("Search cases").fill("");
  await page.getByRole("checkbox", { name: new RegExp(`Checkout ${TAG}`) }).check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);
  await expect(page.getByText(new RegExp(`${HUB}-\\d`)).first()).toBeVisible();

  // Overview's Create a run box lists the shared suite; run it here.
  await page.goto(`/p/${RC}`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await pickKind(page);
  await box.getByRole("button", { name: /A suite/ }).click();
  await box.getByRole("radio", { name: /Shared smoke/ }).check();
  await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${RC}/runs/\\d+`));
  await page.goto(`/p/${RC}/reports`);
  await expect(page.getByRole("link", { name: "Shared smoke", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox").filter({ hasText: "All suites" }).locator("option", { hasText: "Shared smoke" })).toHaveCount(1);
});
