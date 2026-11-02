import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { standaloneProject } from "./projects";

// ver_114 (persona audit finding #1): without email, the message after Add carries the
// person's one-time invite link, and invited rows show when that link runs out.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `I${TAG}`;
const NAME = `Invites ${TAG}`;
const newbie = `nia.${TAG.toLowerCase()}@example.com`;

test("Add gives a message with the invite link, and the link lets them in", async ({ page, browser, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "admin@example.com", "Demo Admin");
  await standaloneProject(page, NAME, KEY);
  await page.goto(`/p/${KEY}/settings`);

  // The false "choose a password the first time" hint is gone.
  await expect(page.locator("#members")).not.toContainText(/password the first time/);
  await expect(page.getByText("You'll get a link to send them. It lets them in once and works for 7 days.")).toBeVisible();

  await page.getByLabel("Add someone by email").fill(newbie);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const note = page.getByRole("status").filter({ hasText: "was added as Member" });
  await expect(note).toContainText("Send them this so they can get in:");
  const message = (await note.getByTestId("invite-message").textContent()) ?? "";
  expect(message).toContain(`You're invited to ${NAME} in Flaw Patrol. Open this link to choose your password and sign in: `);
  expect(message).toContain("(works once, for 7 days)");
  expect(message).not.toContain("/signin");
  const url = /(http\S+\/invite\/\S+)/.exec(message)?.[1];
  expect(url).toBeTruthy();
  await expect(note.getByText("Paste it into Slack, Teams or an email.")).toBeVisible();
  await note.getByRole("button", { name: "Copy message" }).click();
  await expect(note.getByText("Copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);

  // Their row says when the link runs out.
  const until = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const row = page.getByRole("listitem").filter({ hasText: newbie });
  await expect(row).toContainText(`invited, hasn't signed in yet · link works until ${until}`);

  // The link from the message lets them choose a password and sign in.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url!);
  await p.getByLabel("Your name").fill("Nia New");
  await p.getByLabel("Choose a password").fill("nia first password 1");
  await p.getByLabel("Confirm password").fill("nia first password 1");
  // Since ver_137 the invite signs them straight in.
  await p.getByRole("button", { name: "Choose password and sign in" }).click();
  await expect(p).not.toHaveURL(/signin|invite/);
  await ctx.close();

  // Someone who already has a password still gets the short sign-in-as-usual message.
  await page.reload();
  await page.getByLabel("Add someone by email").fill("lead@example.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const usual = page.getByRole("status").filter({ hasText: "was added as Member" });
  await expect(usual.getByTestId("invite-message")).toHaveText(
    "You've been added to a team in Flaw Patrol. Sign in at http://localhost:3100/signin with lead@example.com and your usual password.",
  );
  await expect(page.getByRole("listitem").filter({ hasText: newbie })).not.toContainText("link works until");
});
