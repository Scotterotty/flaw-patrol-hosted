import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject, openReleaseBox } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Umb ${TAG}`;
const HUB = `U${TAG}`;
const OLD = `UO${TAG}`;

async function newProject(page: Page, key: string, name: string) {
  await page.goto("/");
  await standaloneProject(page, name, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/`));
}

test("umbrella: shared library, platforms, Start next release, bugs and shortcuts", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "admin@example.com", "Demo Admin");

  // An old project with a case of its own, to pull up into the umbrella.
  await newProject(page, OLD, `Old ${TAG}`);
  await page.goto(`/p/${OLD}/cases/new`);
  await page.getByLabel("Title").fill(`Join a space ${TAG}`);
  await page.getByLabel("Step 1 action").fill("Open the invite link");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: `Join a space ${TAG}` })).toBeVisible();

  // Make the umbrella holding it.
  await page.goto("/");
  await page.getByRole("button", { name: "New umbrella" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Product name").fill(NAME);
  await dialog.getByLabel("Key").fill(HUB);
  await dialog.getByRole("checkbox", { name: new RegExp(`^Old ${TAG}`) }).check();
  await expect(dialog.getByRole("checkbox", { name: /Move their cases/ })).toBeChecked();
  await dialog.getByRole("button", { name: `Make ${NAME} with 1 moved in` }).click();
  await expect(page).toHaveURL(/\/g\//);
  const home = page.url();
  await expect(page.getByRole("heading", { name: `${NAME} Umbrella` })).toBeVisible();
  await expect(page.getByRole("navigation", { name: `${NAME} umbrella` }).first()).toContainText("Case library");

  // Making the umbrella moved its cases into the shared library (the box is ticked by default).
  await page.goto(`/p/${HUB}/cases`);
  await expect(page.getByText(/test cycles? runs? these cases/)).toBeVisible();
  await expect(page.getByRole("link", { name: `Join a space ${TAG}` })).toBeVisible();

  // A shared suite, and a platform that runs it.
  await page.goto(`/p/${HUB}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Add all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);
  // Start next release adds the platform on the spot (ver_86: no Platforms row in Settings)
  // and makes a Web project with its run already set up.
  await page.goto(home);
  await openReleaseBox(page);
  await page.getByLabel("Platform name").fill("Web");
  await page.getByLabel("Suite it runs").selectOption({ label: "Smoke" });
  await page.getByLabel("Release", { exact: true }).fill("RC7");
  await expect(page.getByText(`${NAME} Web RC7`)).toBeVisible();
  await page.getByRole("button", { name: "Start RC7" }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByText("Smoke").first()).toBeVisible();
  await page.getByRole("link", { name: /Smoke/ }).first().click();
  await expect(page.getByText(`${HUB}-1`)).toBeVisible();

  // Runs across the umbrella, and an empty bug list.
  await page.goto(`${home}/runs`);
  await expect(page.getByText(`${NAME} Web RC7`).filter({ visible: true }).first()).toBeVisible();
  await page.goto(`${home}/bugs`);
  await expect(page.getByText("No bugs yet")).toBeVisible();

  // The Projects page shows the umbrella card; pin a shortcut and it shows for everyone.
  await page.goto("/");
  const card = page.getByRole("region", { name: `${NAME} umbrella` });
  await expect(card.getByRole("link", { name: `Open ${NAME} →` })).toBeVisible();
  // No "Inside:" row of test cycles on the card (ver_76).
  await expect(card).not.toContainText("Inside:");
  await card.getByRole("button", { name: /Edit shortcuts/ }).click();
  await card.getByLabel("Find a page").fill("flagged");
  await card.getByRole("button", { name: "Pin Flagged cases" }).click();
  await expect(card.getByText("5 of 6")).toBeVisible();
  await card.getByRole("button", { name: "Done" }).click();
  await page.reload();
  await expect(page.getByRole("region", { name: `${NAME} umbrella` }).getByRole("link", { name: /Flagged cases/ })).toBeVisible();

  // The RC project can keep its own team.
  await page.goto(home);
  await page.getByRole("link", { name: `${NAME} Web RC7` }).first().click();
  await page.waitForURL(/\/p\/[^/]+/);
  const key = page.url().split("/p/")[1].split("/")[0];
  await page.goto(`/p/${key}/settings`);
  await expect(page.getByText(`Part of ${NAME}`)).toBeVisible();
  await page.getByRole("switch", { name: /Keep members separate/ }).check();
  await expect(page.getByText(/Only the people listed below/)).toBeVisible();
});
