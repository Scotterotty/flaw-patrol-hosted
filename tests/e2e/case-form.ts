import { expect, type Page } from "@playwright/test";

/** A new case folds priority, tags, preconditions and test data under More details (ver_216). Opens it if closed. */
export async function openMoreDetails(page: Page) {
  const btn = page.getByTestId("case-more-details");
  await expect(btn).toBeVisible();
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
}
