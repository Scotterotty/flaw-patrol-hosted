import { PrismaClient } from "@prisma/client";
import { expect, test, type Locator } from "@playwright/test";
import { signIn } from "./auth";

// Roomier bug form (Scott, Nov 10 2026): "These boxes are really small and I shouldn't need a scroll bar …
// we should be able to drag the window wider or skinnier." The OKO form opens wider, its boxes are bigger
// and grow as you type, Reproduction history never scrolls sideways and shows Scott's hints, big popups
// drag wider or narrower by either edge, and User name & ID is remembered (not your Flaw Patrol name).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `RB${TAG}`;
const JIRA = `http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`;

const width = async (l: Locator) => Math.round((await l.boundingBox())!.width);

test("the OKO bug form is roomy, resizable and never scrolls sideways", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "admin@example.com", "Demo Admin");
  const db = new PrismaClient();
  try {
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    await db.user.update({ where: { id: admin.id }, data: { bugProfile: {} } });
    await db.project.create({ data: { key: KEY, name: `Roomy ${TAG}`, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
  } finally {
    await db.$disconnect();
  }
  await page.goto(`/p/${KEY}/settings`);
  await page.getByLabel("Jira site").fill(JIRA);
  await page.getByLabel("Jira project key").fill("QA");
  await page.getByLabel("Account email").fill("qa-bot@example.com");
  await page.getByLabel("API token").fill("secret-token");
  await page.getByRole("button", { name: "Connect Jira" }).click();
  await expect(page.getByText(`Connected to ${JIRA}, Jira project QA`)).toBeVisible();
  const db2 = new PrismaClient();
  try {
    const p = await db2.project.findUniqueOrThrow({ where: { key: KEY } });
    await db2.jiraConfig.update({ where: { projectId: p.id }, data: { sharedTemplateId: "shared_oko_layout", bugTemplate: { on: true, clientTag: "WEB", team: "", clients: [], olyEnv: [], imported: null } } });
  } finally {
    await db2.$disconnect();
  }

  await page.goto(`/p/${KEY}/bugs?write=1`);
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box.getByLabel("Repro steps")).toBeVisible();

  // Opens wider than other big boxes (1024px, was 672px).
  const normal = await width(box);
  expect(normal).toBeGreaterThan(1000);

  // Reproduction history: Scott's hints, User name & ID starts empty (not "Demo Admin"), nothing scrolls sideways.
  const history = box.getByTestId("repro-history");
  await expect(history.getByLabel("Context")).toHaveAttribute("placeholder", "Browser\nGraphics Driver\nDevice\nOS");
  await expect(history.getByLabel("User name & ID")).toHaveAttribute("placeholder", "Display Name & ID");
  await expect(history.locator("#h-client")).toHaveAttribute("placeholder", "Client Version");
  await expect(history.getByLabel("CSP")).toHaveAttribute("placeholder", "xx.xx.x");
  await expect(history.locator("#h-envTenant")).toHaveAttribute("placeholder", "Env.\nTenant");
  await expect(history.getByLabel("Repros")).toHaveAttribute("placeholder", "x/x");
  await expect(history.getByLabel("User name & ID")).toHaveValue("");
  const sideways = () => box.locator("[data-box-scroll]").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await sideways()).toBeLessThanOrEqual(0);

  // Boxes grow as you type instead of scrolling inside a tiny box.
  const what = box.getByLabel("What happened");
  const short = (await what.boundingBox())!.height;
  expect(short).toBeGreaterThanOrEqual(100);
  await what.fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n"));
  expect((await what.boundingBox())!.height).toBeGreaterThan(short + 80);

  // Drag the right edge: the box grows on both sides, stays centered, shows the hint, and is remembered.
  const edge = box.getByTestId("box-edge-right");
  const e = (await edge.boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 - 3, e.y + e.height / 2); // under 6px: nothing yet
  expect(await width(box)).toBe(normal);
  await page.mouse.move(e.x + e.width / 2 - 100, e.y + e.height / 2, { steps: 5 });
  await expect(box.getByTestId("box-drag-hint").last()).toBeVisible();
  await page.mouse.up();
  const narrower = await width(box);
  expect(narrower).toBeLessThan(normal - 150);
  const b = (await box.boundingBox())!;
  expect(Math.abs(b.x + b.width / 2 - 720)).toBeLessThan(4);
  // Narrow: Reproduction history wraps to fewer boxes per line, still no sideways scroll.
  expect(await sideways()).toBeLessThanOrEqual(0);

  // Esc while dragging puts it back, and doesn't close the box.
  const e2 = (await edge.boundingBox())!;
  await page.mouse.move(e2.x + e2.width / 2, e2.y + e2.height / 2);
  await page.mouse.down();
  await page.mouse.move(e2.x + e2.width / 2 + 120, e2.y + e2.height / 2, { steps: 5 });
  expect(await width(box)).toBeGreaterThan(narrower + 100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(box).toBeVisible();
  expect(await width(box)).toBe(narrower);

  // Keyboard: arrow keys on the edge resize too.
  await edge.focus();
  await page.keyboard.press("ArrowRight");
  expect(await width(box)).toBe(narrower + 32);

  // Remembered next time it opens.
  await box.getByRole("button", { name: "Close" }).click();
  await page.getByTestId("write-bug").click();
  await expect(box.getByLabel("Repro steps")).toBeVisible();
  expect(await width(box)).toBe(narrower + 32);

  // Double-click either edge goes back to normal.
  await box.getByTestId("box-edge-left").dblclick();
  expect(await width(box)).toBe(normal);

  // File it, then User name & ID and Context come back next time, and the Flaw Patrol name never shows.
  await box.getByLabel("Brief summary").fill(`Roomy ${TAG}`);
  await box.getByLabel("What happened").fill("The avatar flickers");
  await box.getByLabel("Repro steps").fill("1. Walk forward");
  await history.getByLabel("Context").fill("Chrome 157\nRTX 4070\nDesktop\nWindows 11");
  await history.getByLabel("User name & ID").fill("scott.qa · 4f2a");
  await box.getByRole("button", { name: "Save and file in Jira" }).click();
  await expect(box).toHaveCount(0);
  await page.getByTestId("write-bug").click();
  await expect(history.getByLabel("User name & ID")).toHaveValue("scott.qa · 4f2a");
  await expect(history.getByLabel("Context")).toHaveValue("Chrome 157\nRTX 4070\nDesktop\nWindows 11");
});

test("on a phone the box fills the screen, has no drag edges, and nothing scrolls sideways", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/bugs?write=1`);
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await expect(box.getByLabel("Repro steps")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await width(box)).toBeGreaterThan(340);
  await expect(box.getByTestId("box-edge-right")).toBeHidden();
  expect(await box.locator("[data-box-scroll]").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
