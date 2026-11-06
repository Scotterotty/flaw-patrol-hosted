import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

const KEY = `S${Date.now().toString(36).slice(-4).toUpperCase()}`;

test("step results show up live, merge, and a part-done case saves as In progress", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a, "admin@example.com", "Demo Admin");
  await standaloneProject(a, `Live steps ${KEY}`, KEY);
  const testerEmail = `pair-${KEY.toLowerCase()}@example.com`;
  await a.goto(`/p/${KEY}/settings`);
  await a.getByLabel("Add someone by email").fill(testerEmail);
  await a.getByRole("button", { name: "Add", exact: true }).click();
  await expect(a.getByText(testerEmail, { exact: true })).toBeVisible();

  await a.goto(`/p/${KEY}/cases/new`);
  await a.getByLabel("Title").fill("Checkout");
  for (let i = 1; i <= 3; i++) {
    if (i > 1) await a.getByRole("button", { name: "+ Add step" }).click();
    await a.getByLabel(`Step ${i} action`).fill(`Action ${i}`);
    await a.getByLabel(`Step ${i} expected result`).fill(`Result ${i}`);
  }
  await a.getByRole("button", { name: "Create case" }).first().click();
  await expect(a.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await a.goto(`/p/${KEY}/suites/new`);
  await a.getByLabel("Name", { exact: true }).fill("Smoke");
  await a.getByRole("checkbox").first().check();
  await a.getByRole("button", { name: "Create suite" }).click();
  await a.getByRole("button", { name: "Create a run" }).click();
  await a.getByRole("button", { name: "Create run", exact: true }).click();
  await expect(a).toHaveURL(new RegExp(`/p/${KEY}/runs/1$`));

  const b = await (await browser.newContext()).newPage();
  await signIn(b, testerEmail, "Pat Pair");

  // Both open the case.
  await a.goto(`/p/${KEY}/runs/1/execute`);
  await b.goto(`/p/${KEY}/runs/1/execute`);
  const step = (p: typeof a, n: number) => p.getByRole("group", { name: `Step ${n} status` });
  await expect(step(a, 1)).toBeVisible();
  await expect(step(b, 1)).toBeVisible();

  // A passes step 1; B sees it without reloading, and sees who's on it.
  await step(a, 1).getByRole("button", { name: "Passed" }).click();
  await expect(a.getByText("Step results saved")).toBeVisible();
  await expect(step(b, 1).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  await expect(b.getByText("Demo Admin is working on this case")).toBeVisible();

  // B passes step 2: it reaches A, and A's step 1 isn't wiped by B's save.
  await step(b, 2).getByRole("button", { name: "Passed" }).click();
  await expect(b.getByText("Step results saved")).toBeVisible();
  await expect(step(a, 2).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  await expect(step(a, 1).getByRole("button", { name: "Passed" })).toHaveAttribute("aria-pressed", "true");
  await expect(a.getByText("Pat Pair is working on this case")).toBeVisible();

  // Not finished: Save progress, no case result needed.
  await expect(a.getByRole("button", { name: "Save progress", exact: true })).toBeVisible();
  await a.getByRole("button", { name: /^Save and (next|finish)$/ }).click();
  await a.goto(`/p/${KEY}/runs/1`);
  const row = a.getByRole("row").filter({ hasText: "Checkout" });
  await expect(row).toContainText("In progress");
  await expect(row).toContainText("2/3");
  await a.goto(`/p/${KEY}/runs/1/execute`);
  await expect(a.getByRole("link", { name: /Checkout/ })).toContainText("2/3");
  await a.goto(`/p/${KEY}/runs/1`);

  // Finishing it brings the normal Save buttons back.
  await b.reload();
  await step(b, 3).getByRole("button", { name: "Passed" }).click();
  await expect(b.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await b.getByRole("button", { name: /Save and (next|finish)/ }).click();
  await expect(row).toContainText("Passed", { timeout: 15000 });
});
