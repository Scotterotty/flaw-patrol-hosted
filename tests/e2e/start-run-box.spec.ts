import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { pickKind } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Box ${TAG}`;
const HUB = `B${TAG}`;

async function libraryCase(page: Page, title: string) {
  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Step 1 action").fill("Open the app");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("one Start a run box: whole library, a suite or picked cases, in one or more test cycles", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // An umbrella with two platforms' test cycles and three library cases.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByLabel("Release", { exact: true }).fill("RC4");
  await dialog.getByLabel("Platform 1").fill("Web");
  await dialog.getByRole("button", { name: "＋ Add a platform" }).click();
  await dialog.getByLabel("Platform 2").fill("Unity");
  await dialog.getByRole("button", { name: `Make ${NAME} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();
  // The Umbrellas page card has no "Inside:" row any more.
  await page.goto("/");
  await expect(page.getByRole("region", { name: `${NAME} umbrella` })).not.toContainText("Inside:");
  for (const t of ["Log in", "Log out", "Join a space"]) await libraryCase(page, `${t} ${TAG}`);

  // From the umbrella's Test runs: pick two cases, run them on both platforms at once.
  await page.goto(`${home}/runs`);
  await page.getByRole("button", { name: "Start a run" }).click();
  const box = page.getByRole("dialog", { name: "Start a run" });
  await pickKind(page);
  // The box opens fresh: nothing picked, no test cycle ticked.
  await expect(box.getByTestId("run-todo")).toContainText("Pick what to run");
  await expect(box.getByTestId("run-todo")).toContainText("Tick a test cycle");
  for (const name of [/Whole Case library/, /A suite/, /Pick cases/]) await expect(box.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
  await box.getByRole("button", { name: /Pick cases/ }).click();
  await box.getByLabel("Search cases").fill("Log");
  await box.getByRole("button", { name: "Tick all 2" }).click();
  // ver_99: no test cycle is ticked for you.
  await expect(box.getByRole("checkbox", { name: `${NAME} Web RC4` })).not.toBeChecked();
  await expect(box.getByRole("checkbox", { name: `${NAME} Unity RC4` })).not.toBeChecked();
  await box.getByRole("checkbox", { name: `${NAME} Web RC4` }).check();
  await box.getByRole("checkbox", { name: `${NAME} Unity RC4` }).check();
  await expect(box.getByTestId("run-todo")).toContainText(`One run in each: ${NAME} Web RC4, ${NAME} Unity RC4`);
  await expect(box.getByTestId("run-todo")).toContainText("2 cases");
  await box.getByLabel("Run name").fill(`Login check ${TAG}`);
  await box.getByRole("button", { name: "Start 2 runs" }).click();
  await expect(page).toHaveURL(new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/runs`));
  await expect(page.getByText(`Login check ${TAG}`).filter({ visible: true })).toHaveCount(2);
  // Nobody was given the cases.
  await page.getByText(`Login check ${TAG}`).filter({ visible: true }).first().click();
  await expect(page.getByRole("cell", { name: "Unassigned" })).toHaveCount(2);

  // From the Case library: tick a case and Run selected opens the same box with it picked.
  await page.goto(`/p/${HUB}/cases`);
  await page.getByRole("checkbox", { name: new RegExp(`Select ${HUB}-3`) }).check();
  await page.getByRole("button", { name: "Run 1 selected…" }).click();
  await pickKind(page);
  await expect(box.getByText("1 picked")).toBeVisible();
  // Run it in Web only, and go straight to testing.
  await box.getByRole("checkbox", { name: `${NAME} Web RC4` }).check();
  await box.getByRole("button", { name: "Start and test now" }).click();
  await expect(page).toHaveURL(/\/runs\/2\/execute/);
  await expect(page.getByText(`Join a space ${TAG}`).first()).toBeVisible();

  // Inside a test cycle: the same umbrella menu, with the test cycle lit under Test cycles and its settings under Settings (ver_87).
  await page.goto(home);
  await page.getByRole("link", { name: `${NAME} Unity RC4` }).first().click();
  const nav = page.getByRole("navigation", { name: `${NAME} umbrella` }).first();
  await expect(nav.getByRole("link", { name: "Case library" })).toHaveAttribute("href", `/p/${HUB}/cases`);
  await expect(nav.getByRole("link", { name: "Shared steps" })).toBeVisible();
  await expect(nav.getByText("Test cycles · RC4")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Unity", exact: true })).toHaveAttribute("aria-current", "page");
  // ver_117: one Settings link for the umbrella and its test cycles.
  await expect(nav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
  await page.getByRole("button", { name: "Start a run" }).click();
  await pickKind(page);
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  // Opened from the Unity test cycle, so Unity is ticked for you (ver_85).
  await expect(box.getByRole("checkbox", { name: `${NAME} Unity RC4` })).toBeChecked();
  await expect(box.getByRole("checkbox", { name: `${NAME} Web RC4` })).not.toBeChecked();
  await expect(box.getByTestId("run-todo")).toContainText("3 cases");
  // ver_99: the release is offered, not filled in.
  await expect(box.getByLabel("Release", { exact: true })).toHaveValue("");
  await box.getByRole("button", { name: "Use RC4" }).click();
  await expect(box.getByLabel("Release", { exact: true })).toHaveValue("RC4");
  await box.getByRole("button", { name: /^Start (run|smoke test)$/ }).click();
  await expect(page).toHaveURL(/\/runs\/2$/);

  // Umbrella reports: every test cycle in one place, narrowed by platform.
  await page.goto(`${home}/reports`);
  await expect(page.getByRole("heading", { name: "By test cycle" })).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME} Web RC4` })).toBeVisible();
  await expect(page.getByRole("link", { name: `${NAME} Unity RC4` })).toBeVisible();
  await page.getByLabel("Platform").selectOption("unity");
  await expect(page.getByRole("link", { name: `${NAME} Web RC4` })).toHaveCount(0);
  await page.getByRole("link", { name: "Release status" }).click();
  await expect(page).toHaveURL(/\/rc/);
});
