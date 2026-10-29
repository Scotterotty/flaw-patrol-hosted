import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const A = `PA${TAG}`;
const B = `PB${TAG}`;

test("projects page: search, star, recent and archive", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  for (const [key, name] of [[A, `Alpha ${TAG}`], [B, `Bravo ${TAG}`]]) {
    await page.goto("/");
    await standaloneProject(page, name, key);
    await expect(page).toHaveURL(new RegExp(`/p/${key}/`));
  }

  // The test database has plenty of projects, so search shows; "/" jumps to it.
  await page.goto("/");
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search umbrellas and test cycles")).toBeFocused();
  await page.keyboard.type(`alpha ${TAG.toLowerCase()}`);
  await expect(page.getByRole("region", { name: "1 match" }).getByRole("link")).toHaveText(`Alpha ${TAG}`);
  await page.keyboard.press("Escape");

  // Star Bravo: it moves to Starred.
  await page.getByRole("button", { name: `Star Bravo ${TAG}` }).click();
  const starred = page.getByRole("region", { name: "Starred" });
  await expect(starred.getByRole("link", { name: `Bravo ${TAG}` })).toBeVisible();
  await page.reload();
  await expect(starred.getByRole("link", { name: `Bravo ${TAG}` })).toBeVisible();

  // Opening Alpha puts it under Recent.
  await page.getByRole("link", { name: `Alpha ${TAG}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${A}$`));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Recent" }).getByRole("link", { name: `Alpha ${TAG}` })).toBeVisible();

  // Archive Alpha from Settings: banner in the project, collapsed section on the Projects page.
  await page.goto(`/p/${A}/settings`);
  const card = page.getByTestId("archive-card");
  await card.getByRole("button", { name: "Archive…" }).click();
  await card.getByRole("button", { name: "Yes, archive" }).click();
  await expect(card.getByRole("button", { name: "Restore…" })).toBeVisible();
  await expect(page.getByText("This test cycle is archived.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Recent" }).getByRole("link", { name: `Alpha ${TAG}` })).toHaveCount(0);
  const archived = page.locator("details").filter({ hasText: /^▸ Archived \(\d+\)/ });
  await expect(archived.getByRole("link", { name: `Alpha ${TAG}` })).toBeHidden();
  await archived.locator("summary").click();
  await expect(archived.getByRole("link", { name: `Alpha ${TAG}` })).toBeVisible();

  // Restore it and unstar Bravo so other tests see a plain page.
  await page.goto(`/p/${A}/settings`);
  await card.getByRole("button", { name: "Restore…" }).click();
  await card.getByRole("button", { name: "Yes, restore" }).click();
  await expect(page.getByText("This test cycle is archived.")).toHaveCount(0);
  await page.goto("/");
  await page.getByRole("button", { name: `Unstar Bravo ${TAG}` }).click();
  // Other tests may leave a starred group, so check Bravo alone left Starred.
  await expect(page.getByRole("region", { name: "Starred" }).getByRole("link", { name: `Bravo ${TAG}` })).toHaveCount(0);
});
