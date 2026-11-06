import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// Dragging to select text: the selection stays inside the step text it started in, and letting go
// of a drag outside a popup box doesn't close the box (or lose what you typed in it).

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `DS${TAG}`;
const ids = { entry: "" };
const URL_TEXT = "https://content.example.com/manifests/yp34SRmf.m3u8";
const items = [
  { kind: "step", action: "Open the video panel", expected: "The panel opens." },
  { kind: "step", action: "When set to URL can you specify a video URL to use?", expected: `When set to URL, you can paste a video URL into the field.\nExample URL: ${URL_TEXT}` },
  { kind: "step", action: "Can you switch between playing statuses?", expected: "Selecting each option from the dropdown has the correct effect.\nThis is replicated for other users\nPlaying\nPaused\nStopped" },
  { kind: "step", action: "Change the video while it plays", expected: "The new video starts for everyone." },
];

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 999 } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const project = await db.project.create({ data: { key: KEY, name: `Drag select ${TAG}`, caseSeq: 1, runSeq: 1, members: { create: [{ userId: admin.id, role: "ADMIN" }] } } });
    const title = "Video";
    const c = await db.testCase.create({ data: { projectId: project.id, number: 1, title, versions: { create: { version: 1, title, preconditions: "", priority: "HIGH", type: "MANUAL", tags: [], steps: items } } } });
    const run = await db.testRun.create({
      data: { projectId: project.id, number: 1, name: "Drag", createdBy: "Demo Admin", entries: { create: [{ caseId: c.id, caseVersion: 1, position: 0, title, priority: "HIGH", steps: items.map((s, i) => ({ number: String(i + 1), action: s.action, expected: s.expected })) }] } },
      include: { entries: true },
    });
    ids.entry = run.entries[0].id;
  } finally {
    await db.$disconnect();
  }
});

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test("dragging past the end of an expected result copies only that expected result", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.setViewportSize({ width: 1900, height: 870 });
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.entry}`);
  const text = page.getByText("When set to URL, you can paste", { exact: false });
  await text.scrollIntoViewIfNeeded();
  const a = (await text.boundingBox())!;
  const bar = (await page.getByText("Case result", { exact: true }).boundingBox())!;
  await dragBetween(page, { x: a.x + 2, y: a.y + 4 }, { x: bar.x + 400, y: bar.y + bar.height / 2 });
  await page.waitForTimeout(300);
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/select.png` });
  const picked = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  expect(picked).toContain(URL_TEXT);
  expect(picked).not.toContain("Case result");
  expect(picked).not.toContain("Mark the steps above");

  // Holding the mouse down near the bottom scrolls the steps; the selection still stays in the one step.
  await page.evaluate(() => document.getSelection()?.removeAllRanges());
  await text.scrollIntoViewIfNeeded();
  const b = (await text.boundingBox())!;
  await page.mouse.move(b.x + 2, b.y + 4);
  await page.mouse.down();
  await page.mouse.move(bar.x + 900, bar.y + bar.height / 2, { steps: 15 });
  await page.waitForTimeout(1500);
  await page.mouse.up();
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/select-hold.png` });
  const held = await page.evaluate(() => document.getSelection()?.toString() ?? "");
  expect(held).not.toContain("Case result");
  expect(held).not.toContain("Pick the result yourself");
  expect(held).not.toContain("Change the video while it plays");
});

test("a drag that starts in Report a bug and ends outside it keeps the box open", async ({ page }) => {
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto(`/p/${KEY}/runs/1/execute?entry=${ids.entry}`);
  await page.getByRole("button", { name: /Report bug for case/ }).click();
  const box = page.getByRole("dialog", { name: /Report a bug/ });
  await expect(box).toBeVisible();
  const summary = box.getByLabel("Summary", { exact: false }).first();
  await summary.fill("Video URL field ignores pasted links on the second try");
  const s = (await summary.boundingBox())!;
  const view = page.viewportSize()!;
  // Select the summary by dragging left to right, and let go past the box's edge.
  await dragBetween(page, { x: s.x + 6, y: s.y + s.height / 2 }, { x: view.width - 5, y: s.y + s.height / 2 });
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/drag-out.png` });
  await expect(box).toBeVisible();
  await expect(summary).toHaveValue("Video URL field ignores pasted links on the second try");
  // Once you've typed, a click outside doesn't close it either; ✕ does.
  await page.mouse.click(5, view.height - 5);
  await expect(box).toBeVisible();
  await box.getByRole("button", { name: "Close", exact: true }).click();
  await expect(box).toBeHidden();

  // A box you haven't typed in still closes with a click outside.
  await page.getByRole("button", { name: /Report bug for case/ }).click();
  await expect(box).toBeVisible();
  await page.mouse.click(5, view.height - 5);
  await expect(box).toBeHidden();
});
