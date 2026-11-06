import { expect, type Page } from "@playwright/test";

/** Opens Reports' Filter fold (ver_187), retrying until the page has hydrated. Leaves it open if it already is. */
export async function openFilters(page: Page) {
  const toggle = page.getByTestId("report-filter-toggle");
  await expect(async () => {
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click({ timeout: 1000 });
    await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
}
