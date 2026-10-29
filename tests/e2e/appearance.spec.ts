import { expect, test } from "@playwright/test";
import path from "node:path";
import { signIn } from "./auth";

const PICTURE = path.join(__dirname, "fixtures", "avatar.png");

test("people pick a theme and a profile picture", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/account");

  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByText("Ocean", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "ocean");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "ocean");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe("rgb(248, 250, 252)");

  await page.getByLabel("Profile picture").setInputFiles(PICTURE);
  const img = page.locator('header img[src^="/api/avatars/"]');
  await expect(img).toBeVisible();
  const res = await page.request.get((await img.getAttribute("src"))!);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()["content-type"]).toMatch(/^image\/(webp|png)$/);

  await page.getByLabel("Text font").selectOption("opendyslexic");
  await page.getByLabel("Heading font").selectOption("body");
  await expect(page.locator("html")).toHaveAttribute("data-font-body", "opendyslexic");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-font-body", "opendyslexic");
  await expect(page.locator("html")).toHaveAttribute("data-font-heading", "body");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("OpenDyslexic");
  await page.getByLabel("Heading font").selectOption("bluu-next");
  await page.waitForTimeout(500);
  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("h1")!).fontFamily)).toContain("Bluu Next");

  // Put things back for the other tests.
  await page.getByLabel("Text font").selectOption("poppins");
  await page.getByLabel("Heading font").selectOption("young-serif");
  await expect(page.locator("html")).toHaveAttribute("data-font-heading", "young-serif");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(img).toHaveCount(0);
  await page.getByText("Light", { exact: true }).click();
  await page.locator("label").filter({ has: page.locator(`input[value="violet"]`) }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await page.waitForTimeout(500);
});
