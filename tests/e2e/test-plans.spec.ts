import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// Configurations and test plans: one run per ticked value, grouped as one plan.
const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Plan ${TAG}`;
const HUB = `T${TAG}`;

test("Configurations make a test plan: one run per value, a plan page, a Grid and the value in the steps", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // An umbrella with two test cycles, and a case whose step has a {{song}} blank.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByTestId("u-more").click();
  await dialog.getByLabel("Release", { exact: true }).fill("RC23");
  await dialog.getByLabel("Platform 1").fill("Web");
  await dialog.getByRole("button", { name: "＋ Add a platform" }).click();
  await dialog.getByLabel("Platform 2").fill("Unity");
  await dialog.getByRole("button", { name: `Make ${NAME} with 2 new test cycles` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url().replace(/\/$/, "");
  await page.goto(`/p/${HUB}/cases/new`);
  await page.getByLabel("Title").fill(`Creature spawns on the beat ${TAG}`);
  await page.getByLabel("Step 1 action").fill("Play {{song}} and wait for the first beat");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: `Creature spawns on the beat ${TAG}` })).toBeVisible();

  // Settings → Configurations: paste values one per line.
  await page.goto(`${home}/settings#configurations`);
  await page.getByRole("button", { name: "＋ New Configuration" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Songs");
  await page.getByLabel(/Values, one per line/).fill("Neverender\nLevitating\n\nVon Dutch\nneverender");
  await expect(page.getByText("3 values").first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("configuration")).toContainText("Von Dutch");
  await expect(page.getByTestId("configuration")).toContainText("{{song}}");
  await page.getByRole("button", { name: "＋ New Configuration" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Devices");
  await page.getByLabel(/Values, one per line/).fill("Quest 3\nPC");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("configuration")).toHaveCount(2);

  // Create a run: tick two songs and get one test plan with two runs.
  await page.goto(`${home}/runs`);
  await page.getByRole("button", { name: "Create a run" }).click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Whole Case library/ }).click();
  await box.getByRole("checkbox", { name: `${NAME} Web RC23` }).check();
  await box.getByLabel("Run name").fill(`Creatures pass ${TAG}`);
  const songs = box.getByRole("group", { name: /Songs/ });
  await songs.getByRole("checkbox", { name: "Neverender" }).check();
  await songs.getByRole("checkbox", { name: "Levitating" }).check();
  await expect(box.getByTestId("plan-count")).toHaveText("This makes 1 test plan with 2 runs (1 case each, 2 to test).");
  // Two Configurations make every pairing.
  await box.getByRole("group", { name: /Devices/ }).getByRole("button", { name: "Select all" }).click();
  await expect(box.getByTestId("plan-count")).toContainText("4 runs");
  await box.getByRole("group", { name: /Devices/ }).getByRole("button", { name: "None" }).click();
  await box.getByRole("button", { name: "Create test plan" }).click();

  // The plan page: a summary and one row per value.
  await expect(page).toHaveURL(new RegExp(`/plans/1$`));
  const planUrl = page.url();
  await expect(page.getByRole("heading", { name: new RegExp(`Creatures pass ${TAG}`) })).toBeVisible();
  await expect(page.getByTestId("plan-summary")).toContainText("Not run");
  await expect(page.getByTestId("plan-summary")).toContainText("0% passed");
  const rows = page.getByTestId("plan-runs");
  await expect(rows.getByRole("link", { name: "Neverender" })).toBeVisible();
  await expect(rows.getByRole("link", { name: "Levitating" })).toBeVisible();

  // The Grid: one square per case per value.
  await page.getByRole("link", { name: "Grid" }).click();
  await expect(page.getByTestId("plan-grid").getByRole("link", { name: /on Neverender: Untested/ })).toBeVisible();
  await expect(page.getByTestId("plan-grid").getByRole("link", { name: /on Levitating: Untested/ })).toBeVisible();

  // The runs list shows the plan as one row; ▸ opens its runs.
  await page.goto(`${home}/runs`);
  const planRow = page.getByTestId("plan-row");
  await expect(planRow).toHaveCount(1);
  await expect(planRow).toContainText("Test plan · 2 runs");
  await planRow.locator("summary").click({ position: { x: 10, y: 10 } });
  await planRow.getByRole("link", { name: /Neverender/ }).click();

  // A plan run: the blue line, and the song filled into the step.
  await expect(page.getByTestId("plan-line")).toContainText("Songs: Neverender");
  await page.goto(page.url().replace(/\/runs\/(\d+).*/, "/runs/$1/execute"));
  await expect(page.getByTestId("plan-line")).toContainText("Songs: Neverender");
  await expect(page.getByText("Play Neverender and wait for the first beat").first()).toBeVisible();
  await expect(page.getByText("{{song}}")).toHaveCount(0);

  // Add a value mid-RC.
  await page.goto(planUrl);
  await page.getByRole("button", { name: "＋ Add a run for another value" }).click();
  await page.getByLabel("Songs value").selectOption("Von Dutch");
  await page.getByRole("button", { name: "Add the run" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1 run for Von Dutch" })).toBeVisible();
  await expect(rows.getByRole("link", { name: "Von Dutch" })).toBeVisible();

  // Close the plan: the runs still to finish are listed first, then every run closes at once.
  await page.getByRole("button", { name: "Close the plan" }).click();
  await expect(page.getByText("3 runs still have cases to test:")).toBeVisible();
  await page.getByRole("button", { name: "Close all 3 runs" }).click();
  await expect(page.getByRole("button", { name: "Reopen the plan" })).toBeVisible();
  await page.goto(`${home}/runs?state=closed`);
  await expect(page.getByTestId("plan-row")).toContainText("Test plan · 3 runs");

  // Copy to the next test cycle: the same plan, fresh results.
  await page.goto(planUrl);
  await page.getByRole("button", { name: "Copy to another test cycle" }).click();
  await page.getByLabel("Copy to").selectOption({ label: `${NAME} Unity RC23` });
  await page.getByRole("button", { name: "Copy 3 runs" }).click();
  await expect(page).not.toHaveURL(planUrl);
  await expect(page).toHaveURL(/\/plans\/1$/);
  await expect(page.getByTestId("plan-runs").getByRole("link", { name: "Von Dutch" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close the plan" })).toBeVisible();
});
