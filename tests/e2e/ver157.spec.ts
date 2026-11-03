import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Tag order (ver_157): the Case library Tags row is A to Z by default (capitals don't change
// the order), "Most cases" puts the biggest first, and the pick is remembered.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `TS${TAG}`;
const row = (title: string, tags: string) => `${title} ${TAG},Manual,"${tags}",Open it,It shows`;
const csv = [
  "Title,Type,Tags,Steps,Expected Result",
  row("Sign in with a saved account", "Web, Account"),
  row("Open the hub on a phone", "Web, AR"),
  row("Ask the helper a question", "Web, AI"),
  row("Place a model in the room", "Web, AR"),
].join("\n");

test("tags row sorts A to Z, then by most cases, and remembers it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Tag sort ${TAG}`, KEY);
  await page.goto(`/p/${KEY}/import`);
  await page.locator('input[type="file"]').setInputFiles({ name: "cases.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByLabel(/Don't use folders/).check();
  await page.getByLabel(/No, they're brand new/).check();
  await page.getByRole("button", { name: "Import 4 cases" }).click();
  await expect(page.getByText("Imported 4 test cases")).toBeVisible();

  await page.goto(`/p/${KEY}/cases`);
  const tagsRow = page.getByTestId("tags-row");
  const pills = tagsRow.getByTestId("tag-pill");
  const az = tagsRow.getByRole("button", { name: "A to Z" });
  const most = tagsRow.getByRole("button", { name: "Most cases" });
  await expect(az).toHaveAttribute("aria-pressed", "true");
  await expect(pills).toHaveText(["Account1", "AI1", "AR2", "Web4"]);

  await most.click();
  await expect(most).toHaveAttribute("aria-pressed", "true");
  await expect(pills).toHaveText(["Web4", "AR2", "Account1", "AI1"]);

  await page.reload();
  await expect(tagsRow.getByRole("button", { name: "Most cases" })).toHaveAttribute("aria-pressed", "true");
  await expect(pills).toHaveText(["Web4", "AR2", "Account1", "AI1"]);

  await tagsRow.getByRole("button", { name: "A to Z" }).click();
  await expect(pills).toHaveText(["Account1", "AI1", "AR2", "Web4"]);
});
