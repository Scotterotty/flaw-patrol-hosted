import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `R${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("reminders on a charter and in a session go off by the session clock", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Remind ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  // A charter can carry reminders for every session.
  await page.goto(`/p/${KEY}/cases/new?charter=1`);
  await page.getByLabel("Title").fill("Explore offline play");
  await page.getByLabel("Explore", { exact: true }).fill("the level select");
  const charterReminders = page.getByRole("region", { name: "Reminders" });
  await charterReminders.getByRole("button", { name: "+ Add reminder" }).click();
  const row = charterReminders.getByRole("group", { name: "Reminder 1" });
  await row.getByLabel("Repeat").selectOption("once");
  await row.getByLabel("Minutes").fill("1");
  await row.getByLabel("What to do").fill("Switch to mobile data");
  await page.getByRole("button", { name: "Create charter" }).first().click();
  const mission = page.getByRole("region", { name: "Mission" });
  await expect(mission).toContainText("At 1:00 · Switch to mobile data");

  // Fake the clock so a minute passes in a moment.
  await page.clock.install();
  await page.getByRole("button", { name: "▶ Start session now" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page).toHaveURL(/\/execute/);
  const timer = page.getByRole("region", { name: "Timer" });
  await expect(timer).toContainText("At 1:00 · Switch to mobile data");

  // The tester adds one of their own for this session.
  await timer.getByRole("button", { name: "⏰ Add reminder" }).click();
  const own = timer.getByRole("group", { name: "Reminder 1" });
  await own.getByLabel("Minutes").fill("2");
  await own.getByLabel("What to do").fill("Check memory");
  await timer.getByRole("button", { name: "Done" }).click();
  await expect(timer).toContainText("Every 2 min · Check memory");

  await page.getByRole("button", { name: "Start session" }).click();
  await page.clock.fastForward("01:05");
  const alert = page.getByRole("alert").filter({ hasText: "Switch to mobile data" });
  await expect(alert).toContainText("1:00");
  await expect(page.getByRole("timer")).toHaveText(/^5\d:\d\d$/);
  await alert.getByRole("button", { name: "Log a note" }).click();
  await expect(page.getByLabel("New note")).toHaveValue("Switch to mobile data: ");
  await expect(page.getByLabel("New note")).toBeFocused();

  await page.clock.fastForward("01:00");
  const second = page.getByRole("alert").filter({ hasText: "Check memory" });
  await expect(second).toContainText("2:00");
  await second.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "⏰" })).toHaveCount(0);

  // The session's own reminder is kept with the draft.
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Session saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Timer" })).toContainText("Every 2 min · Check memory");
  await expect(page.getByRole("alert").filter({ hasText: "⏰" })).toHaveCount(0);
});
