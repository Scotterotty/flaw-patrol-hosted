import { expect, test } from "@playwright/test";
import { openSpinners, signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_116: your spinner shows in the corner whenever something takes more than a third of a
// second, and the Start box shows it from the moment you press Start.

const run = Date.now().toString(36).slice(-4).toUpperCase();
const csv = ["Title,Steps,Expected Result", `Open the shop ${run},Open the shop,Shop shows`].join("\n");

test("a slow page shows the corner spinner until it opens, and says so after 10 seconds", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Corner ${run}`, `CO${run}`);
  await page.goto(`/p/CO${run}/runs`);
  await expect(page.getByTestId("busy-corner")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-busy-corner", "on");

  // Hold the Reports page back 11 seconds.
  await page.route(/\/reports(\?.*)?$/, async (route) => {
    if (route.request().headers()["rsc"] && !route.request().headers()["next-router-prefetch"]) await new Promise((r) => setTimeout(r, 11_000));
    await route.continue();
  });
  await page.locator("nav").getByRole("link", { name: "Reports" }).first().click();
  const corner = page.getByTestId("busy-corner");
  await expect(corner).toContainText("Opening Reports…");
  await expect(corner.getByTestId("loading-spinner")).toBeVisible();
  await expect(corner).toContainText("Still working, hang tight", { timeout: 15_000 });
  await expect(page).toHaveURL(/\/reports$/, { timeout: 20_000 });
  await expect(corner).toHaveCount(0);
});

test("a quick page change shows no spinner", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account");
  // Count every time the corner appears.
  await page.evaluate(() => {
    const w = window as unknown as { cornerSeen: number };
    w.cornerSeen = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="busy-corner"]')) w.cornerSeen++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  // Only the #part changes: no page load at all.
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "#appearance";
    a.textContent = "Appearance";
    document.body.append(a);
    a.click();
  });
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { cornerSeen: number }).cornerSeen)).toBe(0);
});

test("the Start box shows your spinner while it makes the run, and the corner stays out", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Making ${run}`, `MK${run}`);
  await page.goto(`/p/MK${run}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "shop.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel(/Don't use folders/).check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 1 case" }).click();
  await expect(page.getByText("Imported 1 test case")).toBeVisible();

  await page.goto(`/p/MK${run}/runs`);
  await expect(page.locator("html")).toHaveAttribute("data-busy-corner", "on");
  // Hold the save that makes the run back 2 seconds.
  await page.route(/\/runs(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.getByRole("button", { name: "Start a run" }).first().click();
  const box = page.getByRole("dialog", { name: "Start a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByRole("button", { name: "Start run", exact: true }).click();
  const making = box.getByTestId("run-making");
  await expect(making).toContainText("Making");
  await expect(making).toContainText("Adding 1 case");
  await expect(making.getByTestId("loading-spinner")).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByTestId("busy-corner")).toHaveCount(0);
  await expect(page).toHaveURL(/\/runs\/\d+$/);
  await expect(page.getByRole("dialog", { name: "Start a run" })).toHaveCount(0);
});

test("a slow save shows the corner spinner until it's done", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account#appearance");
  await openSpinners(page);
  const picker = page.getByTestId("spinner-picker").getByRole("list");
  await expect(picker.getByRole("button", { name: /Plain ring/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-busy-corner", "on");
  await page.route(/\/account(\?.*)?(#.*)?$/, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await picker.getByRole("button", { name: /Lucky roll/ }).click();
  const corner = page.getByTestId("busy-corner");
  await expect(corner).toContainText("Working…");
  await expect(corner).toHaveCount(0, { timeout: 15_000 });
  await picker.getByRole("button", { name: /Lucky roll/ }).click();
  await expect(corner).toContainText("Working…");
  await expect(corner).toHaveCount(0, { timeout: 15_000 });
});
