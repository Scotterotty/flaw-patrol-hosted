import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("people can make text bigger and turn on display aids", async ({ page }) => {
  await signIn(page, "lead@example.com", "QA Lead");
  await page.goto("/account");
  const html = page.locator("html");
  const rootSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(await rootSize()).toBe("16px");

  await page.locator("label").filter({ has: page.locator('input[name="text-size"][value="125"]') }).click();
  await expect(html).toHaveAttribute("data-text-size", "125");
  expect(await rootSize()).toBe("20px");
  await page.getByLabel("Stronger contrast").check();
  await page.getByLabel("Underline links").check();
  await page.getByLabel("Reduce motion").check();
  await page.waitForTimeout(500);

  await page.reload();
  expect(await rootSize()).toBe("20px");
  await expect(html).toHaveAttribute("data-contrast", "more");
  await expect(html).toHaveAttribute("data-links", "underline");
  await expect(html).toHaveAttribute("data-motion", "reduce");

  // Put things back for the other tests.
  await page.locator("label").filter({ has: page.locator('input[name="text-size"][value="100"]') }).click();
  await page.getByLabel("Stronger contrast").uncheck();
  await page.getByLabel("Underline links").uncheck();
  await page.getByLabel("Reduce motion").uncheck();
  await expect(html).not.toHaveAttribute("data-contrast", "more");
  await page.waitForTimeout(500);
});
