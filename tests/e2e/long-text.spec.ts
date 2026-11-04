import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `W${Date.now().toString(36).slice(-4).toUpperCase()}`;
// No spaces anywhere, like a pasted Confluence link: the browser can't break it unless we let it.
const URL = `https://example.atlassian.net/wiki/spaces/OL/pages/2579726355/${"How+to+Set+Up+Fiducial+Markers+".repeat(8)}end`;
const WORD = "Supercalifragilistic".repeat(12);

/** Fails when anything inside the box is wider than the box itself (text cut off or spilling out). */
async function fits(box: Locator) {
  const { scroll, client } = await box.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll, "content is wider than its box").toBeLessThanOrEqual(client + 1);
}

/** The Expected result header must sit fully inside the steps card, and the two columns must be about even. */
async function stepsTableFits(page: Page) {
  const table = page.locator("[data-steps-table]");
  await expect(table).toBeVisible();
  const card = table.locator("..");
  await fits(card);
  const cardBox = (await card.boundingBox())!;
  const action = (await table.getByRole("columnheader", { name: "Action" }).boundingBox())!;
  const expected = (await table.getByRole("columnheader", { name: "Expected result" }).boundingBox())!;
  expect(expected.x + expected.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  expect(Math.abs(action.width - expected.width)).toBeLessThan(4);
}

test("long links and words wrap on every page that shows steps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Long text ${KEY}`, KEY);

  // Shared step page
  await page.goto(`/p/${KEY}/shared-steps/new`);
  await page.getByLabel("Name").fill("Open the guide");
  await page.getByLabel("Step 1 action").fill(`Open ${URL}`);
  await page.getByLabel("Step 1 expected result").fill(WORD);
  await page.getByRole("button", { name: "Create shared step" }).click();
  await expect(page.getByText("Used in 0 cases")).toBeVisible();
  await stepsTableFits(page);

  // Case page
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Fiducial marker");
  await page.getByLabel("Step 1 action").fill(`Fiducial marker can be setup?\n${URL}`);
  await page.getByLabel("Step 1 expected result").fill(`Setup works\n${WORD}`);
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Fiducial marker" })).toBeVisible();
  await stepsTableFits(page);
  // Links in steps open in a new tab and can be copied.
  await expect(page.locator("[data-steps-table]").getByRole("link", { name: URL })).toHaveAttribute("target", "_blank");
  await expect(page.locator("[data-steps-table]").getByRole("button", { name: `Copy ${URL}` })).toBeVisible();
  const caseUrl = page.url();

  // Old version page
  await page.goto(`${caseUrl}/versions/1`);
  await stepsTableFits(page);

  // Editor
  await page.goto(`${caseUrl}/edit`);
  await expect(page.getByLabel("Step 1 action")).toBeVisible();
  await fits(page.locator("main"));

  // Runner
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Fiducial marker" })).toBeVisible();
  await fits(page.locator("main"));
  await fits(page.locator("html"));
});
