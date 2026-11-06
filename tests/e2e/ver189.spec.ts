import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { pickKind } from "./projects";

// ver_189 (Scott, Nov 6 2026): runs are named by the version being tested, never "R1".
// Version sits up front in Create a run, a hotfix run shows its own version, and a run
// without one offers "Add version" on its page.
const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Ver ${TAG}`;
const HUB = `V${TAG}`;

test("runs show their version in place of R1, and a hotfix shows its own", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByTestId("u-more").click();
  await dialog.getByLabel("Release", { exact: true }).fill("RC 23");
  await dialog.getByLabel("Platform 1").fill("Unity");
  await dialog.getByRole("button", { name: `Make ${NAME} with 1 new test cycle` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();

  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByLabel("Title").fill(`Log in ${TAG}`);
  await page.getByLabel("Step 1 action").fill("Open the app");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: `Log in ${TAG}` })).toBeVisible();

  // Version is right there in the box, not under More details.
  const box = page.getByRole("dialog", { name: "Create a run" });
  const start = async (version: string) => {
    await page.goto(`${home}/runs`);
    await page.getByRole("button", { name: "Create a run" }).click();
    await pickKind(page);
    await box.getByRole("button", { name: /Whole Case library/ }).click();
    await expect(box.getByLabel("Version", { exact: true })).toBeVisible();
    await box.getByLabel("Version", { exact: true }).fill(version);
    await box.getByLabel("Run name").fill(`Smoke ${TAG}`);
    await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
    await expect(page).toHaveURL(/\/runs\/\d+$/);
  };

  await start("2.4.1");
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toContainText(`Smoke ${TAG} v2.4.1`);
  await expect(title).not.toContainText(/\bR\d+\b/);
  await expect(page.getByTestId("run-add-version")).toHaveCount(0);

  // The hotfix build during the RC: its own run, its own version.
  await start("2.4.2");
  await expect(title).toContainText(`Smoke ${TAG} v2.4.2`);

  // The umbrella's Test runs tells the two apart by version.
  await page.goto(`${home}/runs`);
  await expect(page.getByTestId("run-version").filter({ hasText: "v2.4.1" }).first()).toBeVisible();
  await expect(page.getByTestId("run-version").filter({ hasText: "v2.4.2" }).first()).toBeVisible();

  // No version given: the start day shows instead of R1, and the title offers Add version.
  await page.getByRole("button", { name: "Create a run" }).click();
  await pickKind(page);
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  await box.getByLabel("Run name").fill(`No version ${TAG}`);
  await box.getByRole("button", { name: /^Create (run|smoke test)$/ }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(title).not.toContainText(/\bR\d+\b/);
  await page.getByTestId("run-add-version").click();
  const edit = page.getByRole("dialog", { name: "Edit run details" });
  await expect(edit.getByLabel("Version", { exact: true })).toBeFocused();
  await edit.getByLabel("Version", { exact: true }).fill("2.4.3");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(title).toContainText(`No version ${TAG} v2.4.3`);
  await expect(page.getByTestId("run-add-version")).toHaveCount(0);
});
