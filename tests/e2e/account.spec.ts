import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("people can change their own name", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await signIn(page, "admin@example.com", "Demo Admin");

  // Click your name in the top bar.
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Your account" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  // Account cards start folded for a new account (ver_96). Open all is saved 400ms later, so a quick reload can fold them again.
  const openAll = async () => {
    const button = page.getByRole("button", { name: "Open all", exact: true });
    if (await button.isVisible()) await button.click();
  };
  await openAll();
  await page.getByRole("textbox", { name: "Your name" }).fill("Demo Admin Renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('header button[aria-haspopup="menu"]')).toContainText("Demo Admin Renamed");
  await openAll();

  // Put it back for the other tests.
  await page.getByRole("textbox", { name: "Your name" }).fill("Demo Admin");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.goto("/");
  const project = await page.locator('main a[href^="/p/"]').first().getAttribute("href");
  await page.goto(`${project!.split("/").slice(0, 3).join("/")}/settings`);
  // Project settings only link to your account rather than repeating it.
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
  await expect(page.getByText(/Flaw Patrol version \d+\.\d+\.\d+/)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Your account" }).click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await openAll();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveValue("Demo Admin");
  // Your account keeps the left menu of the project you were just in.
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "Your account" }).click();
  await expect(page.locator("nav").getByRole("link", { name: "Test cases" }).first()).toHaveAttribute("href", /\/p\/.+\/cases$/);
  expect(errors.filter((e) => !e.includes("__webpack_require__"))).toEqual([]);
});
