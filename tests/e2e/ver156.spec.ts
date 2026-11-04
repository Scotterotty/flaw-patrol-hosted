import { expect, test, type Page } from "@playwright/test";
import { openAccount, signIn } from "./auth";
import { standaloneProject } from "./projects";

// Adjustable panels (ver_156): drag the line beside a side panel to resize it. A click or a
// small slip does nothing, Esc cancels, double-click or Home resets, the size is remembered,
// a hint shows only while dragging, and Account → Appearance → Reset panel sizes puts all back.
// Big popups get Expand this box / Shrink this box.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `PN${TAG}`;
const csv = [
  "Title,Type,Steps,Expected Result",
  `Pay with a saved card when the cart has two items ${TAG},Manual,Open the cart,Cart shows`,
  `Apply a promo code after picking shipping ${TAG},Manual,Open checkout,Checkout shows`,
].join("\n");

async function drag(page: Page, handle: ReturnType<Page["getByRole"]>, dx: number, opts: { dy?: number; esc?: boolean } = {}) {
  const b = (await handle.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + Math.min(b.height / 2, 300);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + (opts.dy ?? 0), { steps: 6 });
  if (opts.esc) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test("side panels resize by dragging, safely, and remember their size", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Panels ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel(/Don't use folders/).check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 2 cases" }).click();
  await expect(page.getByText("Imported 2 test cases")).toBeVisible();

  await page.goto(`/p/${KEY}/runs`);
  await page.getByRole("button", { name: "Create a run" }).first().click();
  const box = page.getByRole("dialog", { name: "Create a run" });
  await box.getByRole("button", { name: /Every case/ }).click();
  await box.getByRole("button", { name: "Create and test now" }).click();
  await expect(page).toHaveURL(/\/execute/);
  const runUrl = page.url();

  const aside = page.locator("aside").first();
  const handle = page.getByRole("separator", { name: /^Resize the case list/ });
  await expect(handle).toBeVisible();
  const width = async () => Math.round((await aside.boundingBox())!.width);
  const normal = await width();

  // A 4px slip does nothing, and neither does a drag that's mostly up or down.
  await drag(page, handle, 4);
  expect(await width()).toBe(normal);
  await drag(page, handle, 3, { dy: 80 });
  expect(await width()).toBe(normal);

  // While dragging, the hint says how to undo; Esc puts it back.
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + 6, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 126, b.y + 200, { steps: 6 });
  await expect(handle.getByTestId("pane-drag-hint")).toHaveText("Double-click to reset · Esc to cancel");
  await expect(handle.getByTestId("pane-drag-hint")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await width()).toBe(normal);
  await expect(handle.getByTestId("pane-drag-hint")).toBeHidden();

  // A real drag sticks, survives a reload, and letting go ends it.
  await drag(page, handle, 120);
  const wider = await width();
  expect(wider).toBeGreaterThan(normal + 100);
  await page.mouse.move(b.x + 400, b.y + 200);
  expect(await width()).toBe(wider);
  await page.reload();
  await expect(handle).toBeVisible();
  expect(await width()).toBe(wider);

  // It can't grow past 60% of the page.
  await drag(page, handle, 2000);
  const row = (await aside.locator("..").boundingBox())!;
  expect(await width()).toBeLessThanOrEqual(Math.round(row.width * 0.6) + 1);

  // Double-click resets; the keyboard works too (arrow keys, Home).
  await handle.dblclick();
  expect(await width()).toBe(normal);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await width()).toBe(normal + 32);
  await page.keyboard.press("Home");
  expect(await width()).toBe(normal);

  // Resize the left menu, then put every panel back from Account → Appearance.
  const menu = page.getByRole("separator", { name: /^Resize the left menu/ });
  const menuBox = page.locator(".fp-bar").filter({ has: menu });
  const menuNormal = Math.round((await menuBox.boundingBox())!.width);
  await drag(page, menu, 60);
  expect(Math.round((await menuBox.boundingBox())!.width)).toBeGreaterThan(menuNormal + 40);
  await drag(page, handle, 80);
  await openAccount(page, "#appearance");
  await expect(page.getByText("2 resized")).toBeVisible();
  await page.getByRole("button", { name: "Reset panel sizes" }).click();
  await expect(page.getByText("All panels are back to their normal size.")).toBeVisible();
  await page.goto(runUrl);
  await expect(handle).toBeVisible();
  expect(await width()).toBe(normal);
  expect(Math.round((await menuBox.boundingBox())!.width)).toBe(menuNormal);

  // Big popups: Expand this box makes it wider, and it remembers.
  await page.getByRole("button", { name: "Report bug for case" }).click();
  const bug = page.getByRole("dialog", { name: /^Report a bug/ });
  const before = (await bug.boundingBox())!.width;
  await bug.getByRole("button", { name: "Expand this box" }).click();
  await expect(bug.getByRole("button", { name: "Shrink this box" })).toBeVisible();
  expect((await bug.boundingBox())!.width).toBeGreaterThan(before + 200);
  await bug.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Report bug for case" }).click();
  await expect(page.getByRole("button", { name: "Shrink this box" })).toBeVisible();
  await page.getByRole("button", { name: "Shrink this box" }).click();
  await page.getByRole("button", { name: "Close" }).click();
});
