import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Record an area (best for crashes): share the screen once, drag a box, and only the box
// is recorded, so a crash window that opens inside it stays in the video. Chromium is
// told to share this tab without asking, so the browser's own picker is skipped.
test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    args: ["--auto-accept-this-tab-capture", "--auto-select-desktop-capture-source=Flaw Patrol", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const KEY = `RA${Date.now().toString(36).slice(-4).toUpperCase()}`;
const AREA = /Record an area \(best for crashes\)/;

async function openCase(page: Page, key: string, jira = false) {
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Area ${key}`, key);
  if (jira) {
    // The bug box shows its files (and + Add) with Jira connected.
    await page.goto(`/p/${key}/settings`);
    await page.getByLabel("Jira site").fill(`http://localhost:${process.env.MOCK_JIRA_PORT ?? 3199}`);
    await page.getByLabel("Jira project key").fill("RP");
    await page.getByLabel("Account email").fill("qa-bot@example.com");
    await page.getByLabel("API token").fill("secret-token");
    await page.getByRole("button", { name: "Connect Jira" }).click();
    await expect(page.getByText("Connected as QA Bot.")).toBeVisible();
  }
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Crash on door");
  await page.getByLabel("Step 1 action").fill("Walk to the door");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Crash on door" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("All");
  await page.getByRole("button", { name: /^Tick all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create and test now" }).click();
  await expect(page.getByRole("heading", { name: "Crash on door", level: 1 })).toBeVisible();
}

/** Draw a box on the picker's still, from (x1, y1) to (x2, y2) as parts of its width and height. */
async function dragBox(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const stage = page.getByTestId("area-picker").locator("canvas");
  const r = (await stage.boundingBox())!;
  await page.mouse.move(r.x + r.width * x1, r.y + r.height * y1);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width * x2, r.y + r.height * y2, { steps: 5 });
  await page.mouse.up();
}

/** The width and height of the attached video, as the browser plays it. */
async function videoSize(page: Page, href: string) {
  return page.evaluate(async (src) => {
    const v = document.createElement("video");
    v.muted = true;
    v.src = src;
    await new Promise((r) => (v.onloadedmetadata = r));
    return { w: v.videoWidth, h: v.videoHeight };
  }, href);
}

test("Record an area records only the box, and remembers it next time", async ({ page }) => {
  await openCase(page, KEY);
  const full = await page.evaluate(() => ({ w: window.innerWidth * devicePixelRatio, h: window.innerHeight * devicePixelRatio }));

  await page.getByRole("button", { name: AREA }).first().click();
  const picker = page.getByTestId("area-picker");
  await expect(picker).toContainText("Drag a box around the part to record. Only the box is saved.");
  // Only a box will do: there's no whole-screen button, and Enter with no box does nothing.
  await expect(picker.getByRole("button", { name: /whole screen/ })).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(picker).toBeVisible();
  await dragBox(page, 0.1, 0.1, 0.5, 0.6);
  await picker.getByRole("button", { name: "Record this area" }).click();
  await expect(picker).toHaveCount(0);

  const bar = page.getByRole("region", { name: "Screen recording" });
  await expect(bar).toContainText("Recording for");
  // Only one recording at a time.
  await expect(page.getByRole("button", { name: AREA }).first()).toBeDisabled();
  await page.waitForTimeout(1500);
  await bar.getByRole("button", { name: "Stop and attach" }).click();
  const preview = page.getByRole("region", { name: "Recording attached" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Close preview" }).click();
  const chip = page.getByRole("link", { name: /\.webm$/ }).first();
  const href = (await chip.getAttribute("href"))!;
  const size = await videoSize(page, href);
  // About 40% by 50% of the shared picture, not all of it.
  expect(size.w).toBeGreaterThan(full.w * 0.3);
  expect(size.w).toBeLessThan(full.w * 0.5);
  expect(size.h).toBeLessThan(full.h * 0.6);

  // Next time, last time's box is already drawn and Record this area is ready.
  await page.getByRole("button", { name: AREA }).first().click();
  await expect(page.getByTestId("area-box")).toBeVisible();
  await expect(picker.getByRole("button", { name: "Record this area" })).toBeFocused();
  // Esc cancels: nothing is recorded.
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(bar).toHaveCount(0);
});

test("Record an area is in the bug box's Add menu too", async ({ page }) => {
  await openCase(page, `${KEY}B`, true);
  await page.getByRole("button", { name: "Report bug for case" }).click();
  const dialog = page.getByRole("dialog", { name: /^Report a bug/ });
  await dialog.locator("button[aria-haspopup=menu]").first().click();
  await expect(dialog.getByRole("menuitem", { name: AREA })).toBeEnabled();
  await expect(dialog.getByRole("menuitem", { name: AREA })).toHaveAttribute("title", /crash window stays in the video/);
});

test("Record an area is grayed out where the browser can't do it", async ({ page }) => {
  // Firefox and Safari don't hand pages the video frames.
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).MediaStreamTrackProcessor;
    delete (window as unknown as Record<string, unknown>).MediaStreamTrackGenerator;
  });
  await openCase(page, `${KEY}C`);
  const btn = page.getByRole("button", { name: AREA }).first();
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute("title", "Record an area works in Chrome or Edge.");
  // Record screen still works as before.
  await expect(page.getByRole("button", { name: /Record screen/ }).first()).toBeEnabled();
});
