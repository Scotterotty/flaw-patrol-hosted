import { expect, test } from "@playwright/test";
import { openSpinners, signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_108: after Start the box stays up ("Starting…", then "R1 … is ready. Opening it…") until
// the run page shows, and everyone can tick loading spinners in Account → Appearance.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const csv = ["Title,Steps,Expected Result", `Open the shop ${run},Open the shop,Shop shows`].join("\n");

test("the Start box says the run is opening until the run page shows", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Opening ${run}`, `OP${run}`);
  await page.goto(`/p/OP${run}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "shop.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel(/Don't use folders/).check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 1 case" }).click();
  await expect(page.getByText("Imported 1 test case")).toBeVisible();

  await page.goto(`/p/OP${run}/runs`);
  // Hold the run page back a moment, so the "Opening it…" step can be seen.
  await page.route(/\/runs\/\d+(\?.*)?$/, async (route) => {
    if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.getByRole("button", { name: "Create a run" }).first().click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByRole("button", { name: "Create run", exact: true }).click();
  const opening = box.getByTestId("run-opening");
  await expect(opening).toContainText("is ready. Opening it…");
  await expect(opening).toContainText("Made the run with 1 case");
  await expect(box.getByRole("button", { name: "Close" })).toBeDisabled();
  await expect(box.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^R\d+/);
  await expect(page.getByRole("dialog", { name: "Create a run" })).toHaveCount(0);
});

test("anyone can tick loading spinners in Account → Appearance", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account#appearance");
  await openSpinners(page);
  // The tiles; the fold line above them also names what's ticked.
  const picker = page.getByTestId("spinner-picker").getByRole("list");
  await expect(picker.getByRole("button", { pressed: true })).toHaveCount(1);
  await expect(picker.getByRole("button", { name: /Plain ring/ })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("listitem")).toHaveCount(13);
  await picker.getByRole("button", { name: /Bug crawl/ }).click();
  await picker.getByRole("button", { name: /Patrol radar/ }).click();
  await expect(page.getByTestId("spinner-summary")).toHaveText("3 ticked: Plain ring, Patrol radar, Bug crawl");
  await expect(page.locator("html")).toHaveAttribute("data-spinners", "ring radar bug");
  // Saved on the account: still there after a reload.
  await expect.poll(async () => {
    await page.reload();
    return page.locator("html").getAttribute("data-spinners");
  }).toBe("ring radar bug");
  // Unticking all of them leaves the plain ring.
  await openSpinners(page);
  for (const name of [/Plain ring/, /Patrol radar/, /Bug crawl/]) await picker.getByRole("button", { name }).click();
  await expect(page.locator("html")).toHaveAttribute("data-spinners", "ring");
  await expect(picker.getByRole("button", { name: /Plain ring/ })).toHaveAttribute("aria-pressed", "true");
});
