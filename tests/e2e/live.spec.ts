import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `L${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("assignments show up live on other people's screens", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await signIn(a, "admin@example.com", "Demo Admin");
  await signIn(b, "admin@example.com", "Demo Admin");

  await standaloneProject(a, `Live ${KEY}`, KEY);
  await a.goto(`/p/${KEY}/cases/new`);
  await a.getByLabel("Title").fill("Log in");
  await a.getByLabel("Step 1 action").fill("Sign in");
  await a.getByLabel("Step 1 expected result").fill("Home page");
  await a.getByRole("button", { name: "Create case" }).first().click();
  await expect(a.getByRole("heading", { name: "Log in" })).toBeVisible();
  await a.goto(`/p/${KEY}/suites/new`);
  await a.getByLabel("Name", { exact: true }).fill("Smoke");
  await a.getByRole("checkbox").first().check();
  await a.getByRole("button", { name: "Create suite" }).click();
  await a.getByRole("button", { name: "Start test run" }).click();
  // New runs leave every case unassigned unless you pick someone.
  await expect(a.getByLabel("Assign every case to").locator("option:checked")).toHaveText("Nobody yet");
  await a.getByRole("button", { name: "Start run", exact: true }).click();
  await expect(a).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));
  const row = a.getByRole("row").filter({ hasText: "Log in" });
  await expect(row).toContainText("Unassigned");

  // Marking a step in the runner takes the case; the run page updates by itself.
  await b.goto(`/p/${KEY}/runs/1/execute`);
  await expect(b.getByText("Mark a step to start testing. Your teammates will see you're on this case.")).toBeVisible();
  await b.keyboard.press("p");
  await expect(b.getByText("You're testing this case, so teammates see it's taken.")).toBeVisible();
  await expect(row).toContainText("Demo Admin", { timeout: 15000 });

  // Results show up live too.
  await b.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await expect(row).toContainText("Passed", { timeout: 15000 });
});
