import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

// ver_85: Connect to GitHub, Pull from GitHub and the Repositories page, against a
// stand-in GitHub (mock-github.mjs) that answers like Scott's demo repo.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const HUB = `GH${TAG}`;
const CYCLE = `GW${TAG}`;
const NAME = `Shop ${TAG}`;

let groupId = "";

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const hub = await db.project.create({ data: { key: HUB, name: NAME, members: { create: { userId: admin.id, role: "ADMIN" } } } });
    groupId = (await db.projectGroup.create({ data: { name: NAME, hubProjectId: hub.id, platforms: [{ name: "Web", suiteIds: [] }] } })).id;
    await db.project.create({ data: { key: CYCLE, name: `${NAME} Web RC 4`, groupId, platform: "Web", rcName: "RC 4", members: { create: { userId: admin.id, role: "ADMIN" } } } });
  } finally {
    await db.$disconnect();
  }
});

test("connect a GitHub repo, pull a workflow run's results and see the repo's test health", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/g/${groupId}/settings`);
  const row = page.locator("#row-github");
  // Not connected: Pull waits for a repo, and there's no Repositories page yet.
  // ver_94: hidden until a repo is connected and set up.
  await expect(row.getByRole("button", { name: "⬇ Pull from GitHub" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Repositories/ })).toHaveCount(0);

  await row.getByRole("button", { name: "Connect to GitHub" }).click();
  await row.getByLabel("Repository", { exact: true }).fill("https://github.com/Scotterotty/flaw-patrol-ci-demo");
  await row.getByLabel("Access token", { exact: true }).fill("github_pat_wrong");
  await row.getByRole("button", { name: "Save and test" }).click();
  await expect(row.getByText("GitHub didn't accept the access token")).toBeVisible();
  await row.getByLabel("Access token", { exact: true }).fill("github_pat_good");
  await row.getByRole("button", { name: "Save and test" }).click();
  await expect(row.getByLabel("Workflow", { exact: true })).toHaveValue("398809765");
  await expect(row.getByLabel("Results files", { exact: true })).toHaveValue("*.xml");
  await expect(row.getByTestId("github-check")).toHaveText(
    "✓ Connected to Scotterotty/flaw-patrol-ci-demo. Found 3 runs of Tests. The newest has a results file (junit.xml, 9 tests).",
  );
  // ver_88: Save and test already saved the picked workflow, so the repo is ready to pull.
  await expect(row.getByText("workflow Tests · nothing pulled yet")).toBeVisible();
  await expect(row.getByText("✓ Saved. Use Pull from GitHub to bring in a run.")).toBeVisible();
  await row.getByRole("button", { name: "Save", exact: true }).click();
  await expect(row.getByTestId("github-check")).toHaveCount(0);
  await expect(row.getByText("✓ Connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Repositories/ })).toBeVisible();

  // Pull from GitHub: the newest run is picked, then the only test cycle.
  await row.getByRole("button", { name: "⬇ Pull from GitHub" }).click();
  const box = page.getByRole("dialog", { name: "Pull from GitHub" });
  await expect(box.getByLabel("GitHub run 3")).toBeChecked();
  await expect(box.getByText("✕ Failed in GitHub")).toHaveCount(3);
  await box.getByRole("button", { name: "Next: pick the test cycle" }).click();
  await expect(box.getByText("junit.xml from GitHub run 3 · 9 tests")).toBeVisible();
  await expect(box.getByLabel(`${NAME} Web RC 4`)).toBeChecked();
  await expect(box.getByLabel("Build")).toHaveValue("3");
  await box.getByRole("button", { name: "Next: check results" }).click();
  await expect(box.getByText("9 tests from build 3")).toBeVisible();
  await box.getByRole("button", { name: "Save 9 results" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/1$`));
  await expect(page.getByTestId("github-source")).toContainText("Pulled from GitHub run #3");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("GitHub run 3");
  await expect(page.getByTestId("github-source").getByRole("link", { name: "Open on GitHub ↗" })).toHaveAttribute("href", "https://github.com/Scotterotty/flaw-patrol-ci-demo/actions/runs/40598327408");

  // Repositories: the repo's test health.
  await page.getByRole("link", { name: /^Repositories/ }).click();
  const card = page.getByTestId("repo-Scotterotty/flaw-patrol-ci-demo");
  await expect(card.getByText("Run 3", { exact: true })).toBeVisible();
  await expect(card.getByText("✕ 1 of 9 tests failed")).toBeVisible();
  await expect(card.getByText("pulled into Flaw Patrol")).toBeVisible();
  await expect(card.getByText("89%")).toBeVisible();
  const failing = card.getByRole("list", { name: "Failing now" });
  await expect(failing).toContainText("takes 25 percent off (fails on purpose)");
  await expect(failing).toContainText("No bug filed");
  const table = card.getByRole("table", { name: "Recent workflow runs" });
  await expect(table.getByRole("row")).toHaveCount(4);
  // ver_94: named after the GitHub run, not Flaw Patrol's own run number.
  await expect(table.getByRole("link", { name: /GitHub run 3$/ })).toBeVisible();
  await expect(table.getByRole("button", { name: "Pull" })).toHaveCount(2);

  // Pull run 1 from the table: it opens with that run picked.
  await table.getByRole("button", { name: "Pull" }).last().click();
  const again = page.getByRole("dialog", { name: "Pull from GitHub" });
  await expect(again.getByLabel("GitHub run 1")).toBeChecked();
  await expect(again.getByText("Already pulled")).toBeVisible();
  await again.getByRole("button", { name: "Next: pick the test cycle" }).click();
  await again.getByRole("button", { name: "Next: check results" }).click();
  await again.getByRole("button", { name: "Save 9 results" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${CYCLE}/runs/2$`));
  await page.goto(`/g/${groupId}/repos`);
  await expect(card.getByText("Failed 2 runs in a row")).toBeVisible();
  await expect(card.getByText("8 of 9 in the last 2 pulled runs").or(card.getByText("16 of 18 in the last 2 pulled runs"))).toBeVisible();
});
