import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const RC = `RC ${TAG}`;

async function newProject(page: Page, key: string, name: string) {
  await page.goto("/");
  await standaloneProject(page, name, key);
  await expect(page).toHaveURL(new RegExp(`/p/${key}/`));
}

async function startRun(page: Page, key: string, name: string, release: string) {
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Sign in");
  await page.getByLabel("Step 1 action").fill("Sign in works");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page).not.toHaveURL(/\/suites\/new/);
  await page.goto(`/p/${key}/suites`);
  await page.getByRole("link", { name: "Smoke" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByLabel("Run name").fill(name);
  await page.getByLabel("Release", { exact: true }).fill(release);
  await page.getByLabel("Version", { exact: true }).fill("1.0.0");
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/);
}

const card = (page: Page, name: string) => page.locator("div").filter({ has: page.getByRole("link", { name, exact: true }) }).last();

test("projects page: reorder, hide and delete projects", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  const names = [`Org A ${TAG}`, `Org B ${TAG}`, `Org C ${TAG}`];
  for (const [i, name] of names.entries()) await newProject(page, `O${"ABC"[i]}${TAG}`, name);

  // Star all three so they make their own small section.
  await page.goto("/");
  for (const name of names) await page.getByRole("button", { name: `Star ${name}` }).click();
  const starred = page.getByRole("region", { name: "Starred" });
  const order = () => starred.getByRole("heading", { level: 3 }).allTextContents();
  await expect.poll(async () => (await order()).filter((n) => n.endsWith(TAG))).toEqual(names);

  // Move C to the top from its ⋯ menu, then drag A below B.
  await page.getByRole("button", { name: `More for ${names[2]}` }).click();
  await page.getByRole("menuitem", { name: /Move to top/ }).click();
  await expect.poll(async () => (await order()).filter((n) => n.endsWith(TAG))).toEqual([names[2], names[0], names[1]]);
  // Playwright's mouse drag doesn't always start HTML drag and drop, so the events are sent directly.
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page.getByLabel(`Drag to move ${names[0]}`).dispatchEvent("dragstart", { dataTransfer: dt });
  await card(page, names[1]).dispatchEvent("dragover", { dataTransfer: dt });
  await card(page, names[1]).dispatchEvent("drop", { dataTransfer: dt });
  await expect.poll(async () => (await order()).filter((n) => n.endsWith(TAG))).toEqual([names[2], names[1], names[0]]);
  // The order is kept after a reload. Saves go one at a time, so reload until the last one is in.
  await expect(async () => {
    await page.reload();
    expect((await order()).filter((n) => n.endsWith(TAG))).toEqual([names[2], names[1], names[0]]);
  }).toPass({ timeout: 20_000 });

  // Hide B: it moves to the Hidden by you fold, and comes back from there.
  await page.getByRole("button", { name: `More for ${names[1]}` }).click();
  await page.getByRole("menuitem", { name: /Hide for me/ }).click();
  await expect(starred.getByRole("link", { name: names[1] })).toHaveCount(0);
  const hidden = page.locator("details").filter({ hasText: /Hidden by you \(\d+\)/ });
  await hidden.locator("summary").click();
  await page.getByRole("button", { name: `More for ${names[1]}` }).click();
  await page.getByRole("menuitem", { name: /Show again/ }).click();
  await expect(starred.getByRole("link", { name: names[1] })).toBeVisible();

  // Delete A: the key must be typed first.
  await page.getByRole("button", { name: `More for ${names[0]}` }).click();
  await page.getByRole("menuitem", { name: /Delete test cycle/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("0 runs");
  await expect(dialog.getByRole("button", { name: "Delete forever" })).toBeDisabled();
  await dialog.getByLabel("Test cycle key to confirm").fill(`oa${TAG.toLowerCase()}`);
  await dialog.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("link", { name: names[0] })).toHaveCount(0);
  await page.goto(`/p/OA${TAG}`);
  await expect(page.getByText(/not found|couldn.t find/i).first()).toBeVisible();

  // Tidy up so other tests see a plain page.
  await page.goto("/");
  for (const name of names.slice(1)) {
    await page.getByRole("button", { name: `More for ${name}` }).click();
    await page.getByRole("menuitem", { name: /Delete test cycle/ }).click();
    await page.getByLabel("Test cycle key to confirm").fill(`O${name[4]}${TAG}`);
    await page.getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }
});

test("projects page: no Release status button or pick mode; Release status lives in Reports", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await newProject(page, `RU${TAG}`, `Pick Unity ${TAG}`);
  await startRun(page, `RU${TAG}`, "Unity regression", RC);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Release status", exact: true })).toHaveCount(0);
  await page.goto("/?pick=rc");
  await expect(page.getByRole("region", { name: "Release status picks" })).toHaveCount(0);

  await page.goto(`/p/RU${TAG}/reports/rc?release=${encodeURIComponent(RC)}`);
  await expect(page.getByRole("region", { name: "Unity" })).toBeVisible();
});
