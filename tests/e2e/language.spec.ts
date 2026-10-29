import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

test("people switch between US and UK English, and US English is the fallback", async ({ browser }) => {
  const admin = await browser.newPage();
  await signIn(admin, "admin@example.com", "Demo Admin");
  await admin.goto("/account");
  await expect(admin.locator("html")).toHaveAttribute("lang", "en-US");

  // The floating tab bar: clicking a tab lights it and takes you to that section.
  const tabs = admin.getByRole("navigation", { name: "Account sections" });
  await tabs.getByRole("link", { name: "Language" }).click();
  await expect(tabs.getByRole("link", { name: "Language" })).toHaveAttribute("aria-current", "location");
  await expect(admin.locator("#language")).toBeInViewport();

  await admin.getByRole("radio", { name: /UK English/ }).click();
  await expect(admin.locator("html")).toHaveAttribute("lang", "en-GB");
  await expect(admin.getByRole("group").getByText("Colour", { exact: true })).toBeVisible();
  await expect(admin.getByText("So links don't rely on colour alone.")).toBeVisible();
  await expect(admin.getByLabel("Preview")).toContainText("Accent colour · Grey text · Organise folders · Cancelled");
  await admin.reload();
  await expect(admin.getByRole("radio", { name: /UK English/ })).toHaveAttribute("aria-checked", "true");

  // Scrolling to the bottom lights the last tab.
  await admin.mouse.wheel(0, 20000);
  await expect(tabs.getByRole("link", { name: "Password" })).toHaveAttribute("aria-current", "location");

  // Someone who hasn't picked sees US English; there's no team default any more.
  const lead = await browser.newPage();
  await signIn(lead, "lead@example.com", "QA Lead");
  await lead.goto("/account");
  await expect(lead.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(admin.getByLabel("Language for the team")).toHaveCount(0);

  // Put everything back for the other tests.
  await admin.getByRole("radio", { name: /US English/ }).click();
  await expect(admin.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(admin.getByRole("group").getByText("Color", { exact: true })).toBeVisible();
});
