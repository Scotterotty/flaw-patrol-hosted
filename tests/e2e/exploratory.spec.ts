import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `X${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("a charter with a persona runs as a timed session with a log, bugs and an outcome", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "admin@example.com", "Demo Admin");
  await page.goto("/");
  await standaloneProject(page, `Explore ${KEY}`, KEY);
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/cases`));

  // Personas are a tab on the Charters page (ver_96).
  await page.getByRole("navigation").getByRole("link", { name: /^Charters/ }).first().click();
  await page.getByRole("link", { name: /^Personas/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}/charters\\?tab=personas$`));
  const personas = page.getByRole("region", { name: "Personas" });
  await expect(personas).toContainText("No personas yet");
  await personas.getByRole("button", { name: "+ New persona" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("First-time player");
  await dialog.getByLabel("🎮").check({ force: true });
  await dialog.getByLabel("What they're like (optional)").fill("Never played before, taps everything");
  // Adding a persona can go straight to writing a charter as them.
  await dialog.getByRole("button", { name: "Add and write a charter" }).click();
  await expect(page.getByRole("heading", { name: "New charter" })).toBeVisible();
  // The charter's Test persona picker (ver_96) has them picked.
  await expect(page.getByRole("radiogroup", { name: "Test persona" }).getByRole("radio", { checked: true })).toHaveAccessibleName("🎮 First-time player");

  // A charter has a mission instead of steps.
  await page.getByLabel("Title").fill("Explore checkout offline");
  await page.getByLabel("Explore", { exact: true }).fill("checkout and payment");
  await page.getByLabel("With", { exact: true }).fill("airplane mode mid-payment");
  await page.getByLabel("To discover").fill("how payments recover");
  await page.getByLabel("Time limit").selectOption("30");
  await expect(page.getByText("Explore checkout and payment with airplane mode mid-payment to discover how payments recover.")).toBeVisible();
  await page.getByRole("button", { name: "Create charter" }).first().click();
  await expect(page.getByRole("heading", { name: "Explore checkout offline", level: 1 })).toBeVisible();
  const mission = page.getByRole("region", { name: "Mission" });
  await expect(mission).toContainText("checkout and payment");
  await expect(mission).toContainText("30 min");
  await expect(page.getByText("Persona: First-time player").first()).toBeVisible();
  const charterUrl = page.url();

  // The Personas page counts it and links to it.
  await page.goto(`/p/${KEY}/charters?tab=personas`);
  await expect(personas).toContainText("1 charter · 0 cases");

  // A new persona can be added without leaving New charter.
  await page.goto(`/p/${KEY}/cases/new?charter=1`);
  await page.getByRole("region", { name: "Test persona" }).getByRole("button", { name: "+ New persona" }).click();
  // It's added inline in the Test persona box (ver_96).
  const personaBox = page.getByRole("region", { name: "Test persona" });
  await personaBox.getByLabel("Persona name").fill("Screen reader user");
  await personaBox.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("radiogroup", { name: "Test persona" }).getByRole("radio", { checked: true })).toHaveAccessibleName("🧑 Screen reader user");
  await expect(page.getByRole("heading", { name: "New charter" })).toBeVisible();

  // Charters have their own page (ver_93), with their persona, and Test cases no longer lists them.
  await page.goto(`/p/${KEY}/charters`);
  await expect(page.getByRole("link", { name: "Explore checkout offline" })).toBeVisible();
  await expect(page.getByText("First-time player").first()).toBeVisible();
  await page.goto(`/p/${KEY}/cases`);
  await expect(page.getByRole("link", { name: "Explore checkout offline" })).toHaveCount(0);

  // It goes in a suite like any case.
  await page.goto(`/p/${KEY}/suites/new`);
  await page.getByLabel("Name", { exact: true }).fill("Exploring");
  await page.getByRole("button", { name: /^Add all/ }).click();
  await page.getByRole("button", { name: "Create suite" }).click();
  await expect(page.getByText("Charter").first()).toBeVisible();

  // Or it runs on its own, straight from the charter.
  await page.goto(charterUrl);
  // Start exploring (ver_96): one box with the time limit, who explores and where it goes.
  await page.getByRole("button", { name: "▶ Start exploring" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start exploring", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/\d+\/execute/);
  const runUrl = page.url().replace(/\/execute.*$/, "");

  // The session: timer, mission and log.
  await expect(page.getByRole("heading", { name: "Explore checkout offline", level: 1 })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("30:00");
  await expect(page.getByRole("region", { name: "Mission" })).toContainText("how payments recover");
  await page.getByRole("button", { name: "Start exploring" }).click();
  await expect(page.getByRole("timer")).not.toHaveText("30:00");
  const box = page.getByLabel("New note");
  await box.fill("Turned on airplane mode on Confirm");
  await box.press("Enter");
  const log = page.getByRole("list", { name: "Log" });
  await expect(log.getByRole("listitem")).toHaveCount(1);

  // A bug note opens the bug form straight away.
  await page.getByRole("button", { name: "Bug", exact: true }).click();
  await box.fill("Spinner never stops after a second drop");
  await box.press("Enter");
  await page.getByRole("dialog").getByLabel("Summary").fill("Payment spinner never stops");
  await page.getByRole("dialog").getByRole("button", { name: "Save bug" }).click();
  await expect(log.getByText("Payment spinner never stops")).toBeVisible();
  await page.getByRole("button", { name: "Question", exact: true }).click();
  await box.fill("Should the cart show the retry banner?");
  await page.getByRole("button", { name: "Add to log" }).click();
  await expect(log.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Idea", exact: true }).click();
  await box.fill("payment while switching Wi-Fi to mobile data");
  await box.press("Enter");
  await expect(log.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("Session saved")).toBeVisible();

  // Leaving and coming back keeps the log, paused.
  await page.reload();
  await expect(log.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText(/Picked up where you left off/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep exploring" })).toBeVisible();

  // Finish exploring (ver_96): no pass or fail, just what was covered; it's saved as Explored.
  await page.getByRole("button", { name: "Finish exploring" }).click();
  await page.getByLabel("What did you cover?").fill("Retry works once; a second drop hangs.");
  await expect(page.getByText(/1\s*bug\b/)).toBeVisible();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page).toHaveURL(runUrl);
  await expect(page.getByText("Explored").first()).toBeVisible();

  // The charter's history keeps the session log.
  await page.goto(`/p/${KEY}/cases/1`);
  const details = page.getByText(/Session log · \d+:\d\d · 1 note, 1 bug, 1 question, 1 idea/);
  await expect(details).toBeVisible();
  await details.click();
  await expect(page.getByText("Should the cart show the retry banner?")).toBeVisible();
  await expect(page.getByText("Retry works once; a second drop hangs.")).toBeVisible();

  // Reports → Session findings gathers what every session found.
  await page.goto(`/p/${KEY}/reports?view=findings`);
  await expect(page.getByText("Open questions").first()).toBeVisible();
  const group = page.getByRole("region", { name: "Explore checkout offline" });
  await expect(group).toContainText("Should the cart show the retry banner?");
  await expect(group).toContainText("Payment spinner never stops");
  await page.getByRole("navigation", { name: "Finding types" }).getByRole("link", { name: "Questions", exact: true }).click();
  await expect(group).not.toContainText("Payment spinner never stops");
  await group.getByRole("button", { name: "Mark answered" }).click();
  await group.getByLabel("Answer").fill("Yes, after the first failure.");
  await group.getByRole("button", { name: "Save answer" }).click();
  await expect(group).toContainText("✓ Answered");
  await expect(group).toContainText("Yes, after the first failure.");
  await page.getByRole("navigation", { name: "Finding types" }).getByRole("link", { name: "Open questions" }).click();
  await expect(page.getByText("Nothing matches")).toBeVisible();

  // An idea becomes a new charter with the same persona.
  await page.getByRole("navigation", { name: "Finding types" }).getByRole("link", { name: "Ideas", exact: true }).click();
  await group.getByRole("link", { name: "Turn into charter" }).click();
  await expect(page.getByRole("heading", { name: "New charter" })).toBeVisible();
  await expect(page.getByLabel("Explore", { exact: true })).toHaveValue("payment while switching Wi-Fi to mobile data");
  await expect(page.getByRole("radiogroup", { name: "Test persona" }).getByRole("radio", { checked: true })).toHaveAccessibleName("🎮 First-time player");
});
