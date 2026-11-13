import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// Keep what you're typing (Scott, Nov 13 2026: "I hate writing a bug and all of a sudden I
// accidentally refresh the page"). Each form keeps itself in the browser as you type: a refresh
// brings it back with "We kept what you were writing" and Start fresh; saving clears it.

const KEY = `KT${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("Write a bug, a new case and Feedback come back after a refresh", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Keep typing ${KEY}`, KEY);

  // Write a bug: type, refresh, open it again.
  await page.goto(`/p/${KEY}/bugs`);
  const box = page.getByRole("dialog", { name: "Write a bug" });
  await page.getByTestId("write-bug").click();
  await box.getByLabel("Summary").fill("Hair flickers when switching rooms");
  await box.getByLabel("Steps to reproduce").fill("1. Join Lobby\n2. Walk into Gallery");
  await expect(box.getByTestId("kept-saved")).toContainText("Saved on this computer");
  await page.reload();
  await page.getByTestId("write-bug").click();
  await expect(box.getByTestId("kept-note")).toContainText("We kept the bug you were writing");
  await expect(box.getByLabel("Summary")).toHaveValue("Hair flickers when switching rooms");
  await expect(box.getByLabel("Steps to reproduce")).toHaveValue("1. Join Lobby\n2. Walk into Gallery");

  // Esc keeps it too; Start fresh throws it away.
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await page.getByTestId("write-bug").click();
  await expect(box.getByLabel("Summary")).toHaveValue("Hair flickers when switching rooms");
  await box.getByRole("button", { name: "Start fresh" }).click();
  await expect(box.getByLabel("Summary")).toHaveValue("");
  await expect(box.getByTestId("kept-note")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("write-bug").click();
  await expect(box.getByLabel("Summary")).toHaveValue("");
  await expect(box.getByTestId("kept-note")).toHaveCount(0);

  // Saving the bug clears the draft.
  await box.getByLabel("Summary").fill("Door clips through the wall");
  await box.getByLabel("Steps to reproduce").fill("1. Open the door");
  await box.getByLabel("What happened").fill("It goes through the wall");
  await expect(box.getByTestId("kept-saved")).toBeVisible();
  await box.getByRole("button", { name: "Save bug" }).click();
  await expect(box).toHaveCount(0);
  await page.reload();
  await page.getByTestId("write-bug").click();
  await expect(box.getByLabel("Summary")).toHaveValue("");
  await expect(box.getByTestId("kept-note")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A new test case: no "Leave site?" question any more, and it's back after a refresh.
  let asked = false;
  page.on("dialog", (d) => {
    asked = true;
    void d.accept();
  });
  await page.goto(`/p/${KEY}/cases/new`);
  await page.getByLabel("Title").fill("Avatar hair stays still");
  await page.getByLabel("Step 1 action").fill("Walk between rooms");
  await expect(page.getByTestId("kept-saved").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("kept-note")).toContainText("We kept the case you were writing");
  await expect(page.getByLabel("Title")).toHaveValue("Avatar hair stays still");
  await expect(page.getByLabel("Step 1 action")).toHaveValue("Walk between rooms");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Avatar hair stays still" })).toBeVisible();
  await page.goto(`/p/${KEY}/cases/new`);
  await expect(page.getByLabel("Title")).toHaveValue("");
  await expect(page.getByTestId("kept-note")).toHaveCount(0);
  expect(asked).toBe(false);

  // Feedback: the note comes back (pictures don't).
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByRole("menuitem", { name: "Just write a note" }).click();
  const send = page.getByTestId("feedback-send");
  await send.getByText("Idea", { exact: true }).click();
  await send.getByLabel("Tell us more").fill(`Keep my words ${KEY}`);
  await expect(send.getByTestId("kept-saved")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page.getByRole("menuitem", { name: "Just write a note" }).click();
  await expect(send.getByTestId("kept-note")).toContainText("We kept the note you were writing");
  await expect(send.getByLabel("Tell us more")).toHaveValue(`Keep my words ${KEY}`);
});

test("a run's Report a bug comes back after a refresh, for the same case", async ({ page }) => {
  test.setTimeout(180_000);
  const key = `${KEY}R`;
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, `Keep typing runs ${key}`, key);
  await page.goto(`/p/${key}/cases/new`);
  await page.getByLabel("Title").fill("Door opens");
  await page.getByLabel("Step 1 action").fill("Open the door");
  await page.getByRole("button", { name: "Create case" }).first().click();
  await expect(page.getByRole("heading", { name: "Door opens" })).toBeVisible();
  await page.goto(`/p/${key}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Smoke");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Create suite" }).click();
  await page.getByRole("button", { name: "Create a run" }).click();
  await page.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}/runs/1$`));
  await page.getByRole("row").filter({ hasText: "Door opens" }).getByRole("link", { name: "Test" }).click();
  await expect(page.getByRole("heading", { name: "Door opens" })).toBeVisible();

  const dialog = page.getByRole("dialog", { name: /^Report a bug/ });
  await page.getByRole("button", { name: "Report bug for case" }).click();
  await dialog.getByLabel("Summary").fill("Door clips through the wall");
  await expect(dialog.getByTestId("kept-saved")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Report bug for case" }).click();
  await expect(dialog.getByTestId("kept-note")).toContainText("We kept the bug you were writing");
  await expect(dialog.getByLabel("Summary")).toHaveValue("Door clips through the wall");
});
