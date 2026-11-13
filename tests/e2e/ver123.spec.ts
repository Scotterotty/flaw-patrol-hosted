import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_123: Loading spinners folds to one line (Your account → Just for fun since ver_200).
test("Loading spinners folds to one line and remembers if it's open", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account#appearance");
  const section = page.getByTestId("spinner-picker");
  const fold = section.getByRole("button", { name: /^Loading spinners/ });
  await expect(fold).toBeVisible();
  // Other tests may have left it open; start from closed.
  if ((await fold.getAttribute("aria-expanded")) === "true") await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByRole("list")).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Tick all" })).toHaveCount(0);
  await expect(page.getByTestId("spinner-summary")).toHaveText(/^(Plain ring|\d+ ticked: .+)$/);
  await expect(section).toContainText(/\d+ of 14/);

  // Open it, tick all, and the line says so.
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(section.getByRole("listitem")).toHaveCount(14);
  await section.getByRole("button", { name: "Tick all" }).click();
  await expect(page.getByTestId("spinner-summary")).toHaveText(/^14 ticked: Plain ring, Patrol radar, /);
  await expect(section).toContainText("14 of 14");

  // Left open: still open after a reload.
  await expect.poll(async () => {
    await page.reload();
    return page.getByTestId("spinner-picker").getByRole("button", { name: /^Loading spinners/ }).getAttribute("aria-expanded");
  }).toBe("true");

  // Back to the plain ring, then Close all folds it with the cards.
  await section.getByRole("button", { name: "Back to the plain ring" }).click();
  await expect(page.getByTestId("spinner-summary")).toHaveText("Plain ring");
  await expect(section).toContainText("1 of 14");
  const openAll = page.getByRole("button", { name: "Open all", exact: true });
  const closeAll = page.getByRole("button", { name: "Close all", exact: true });
  if (await openAll.count()) await openAll.click();
  await closeAll.click();
  // ver_200: Loading spinners is its own card under Just for fun, so Close all folds it.
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await openAll.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await closeAll.click();
});
