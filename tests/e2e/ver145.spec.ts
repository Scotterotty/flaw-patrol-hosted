import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

// ver_145: Feedback in the top bar of every page. Take a screenshot of the page, mark it up
// (Draw, Box, Circle, Arrow, Text, Hide private info), say what you mean and send it. The
// Feedback page shows your own; workspace admins see everyone's, reply, set a status and
// turn it into a bug. The button sits in the bar and never covers the page.

const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const KEY = `FB${TAG}`;
const NAME = `Feedback ${TAG}`;
const NOTE = `Failed needs a reason ${TAG}`;

test.beforeAll(async () => {
  const db = new PrismaClient();
  try {
    await db.user.updateMany({ data: { whatsNewSeen: 145 } });
    // Start with no replies waiting, so the dot checks below only see this test's feedback.
    await db.feedback.updateMany({ data: { unseen: false } });
    const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@example.com" } });
    const lead = await db.user.findUniqueOrThrow({ where: { email: "lead@example.com" } });
    await db.project.create({
      data: { key: KEY, name: NAME, members: { create: [{ userId: admin.id, role: "ADMIN" }, { userId: lead.id, role: "LEAD" }] } },
    });
  } finally {
    await db.$disconnect();
  }
});

/** Drag across the markup picture, from and to points given as fractions of its size. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByLabel("Your screenshot. Pick a tool, then drag on the picture.").boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

test("send marked-up feedback, reply to it, and turn it into a bug", async ({ browser }) => {
  const lead = await browser.newPage();
  await signIn(lead, "lead@example.com");
  await lead.goto(`/p/${KEY}/runs`);

  // In the top bar, not floating over the page.
  const button = lead.getByRole("button", { name: "Feedback", exact: true });
  await expect(button).toBeVisible();
  const bar = (await lead.locator("header.fp-bar").boundingBox())!;
  const b = (await button.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(bar.y);
  expect(b.y + b.height).toBeLessThanOrEqual(bar.y + bar.height);

  await button.click();
  await lead.getByRole("menuitem", { name: "Take a screenshot of this page" }).click();
  const markup = lead.getByTestId("feedback-markup");
  await expect(markup).toBeVisible({ timeout: 30_000 });
  for (const t of ["Draw", "Box", "Circle", "Arrow", "Text", "Hide private info"]) await expect(markup.getByRole("button", { name: t, exact: true })).toBeVisible();

  // Circle is picked to start with.
  await drag(lead, [0.5, 0.3], [0.7, 0.45]);
  await markup.getByRole("button", { name: "Arrow", exact: true }).click();
  await drag(lead, [0.3, 0.7], [0.5, 0.45]);
  await markup.getByRole("button", { name: "Hide private info", exact: true }).click();
  await drag(lead, [0.05, 0.05], [0.2, 0.1]);
  await markup.getByRole("button", { name: "Undo" }).click();
  await drag(lead, [0.05, 0.05], [0.2, 0.1]);
  await markup.getByRole("button", { name: "Text", exact: true }).click();
  const pic = (await lead.getByLabel("Your screenshot. Pick a tool, then drag on the picture.").boundingBox())!;
  await lead.mouse.click(pic.x + pic.width * 0.3, pic.y + pic.height * 0.6);
  await lead.getByLabel("Words to add").fill("Can it ask why?");
  await lead.getByLabel("Words to add").press("Enter");
  await markup.getByRole("button", { name: "Next" }).click();

  const send = lead.getByTestId("feedback-send");
  await expect(send).toBeVisible();
  await expect(send.getByRole("img", { name: "Picture 1" })).toBeVisible();
  // Where it was sent from comes along by itself.
  await expect(send.getByText(`Where: `)).toContainText(NAME);
  await send.getByRole("button", { name: "Send feedback" }).click();
  await expect(send.getByRole("alert")).toHaveText("Pick what kind of feedback it is.");
  await send.getByText("Confusing", { exact: true }).click();
  await send.getByLabel("Tell us more").fill(NOTE);
  await send.getByRole("button", { name: "Send feedback" }).click();
  await expect(lead.getByRole("dialog", { name: "Thanks for the feedback" })).toBeVisible();
  await lead.getByRole("link", { name: "See your feedback" }).click();
  await expect(lead).toHaveURL(/\/feedback$/);
  await expect(lead.getByRole("button", { name: new RegExp(NOTE) })).toBeVisible();
  await expect(lead.getByRole("img", { name: "Picture 1 sent with the feedback" })).toBeVisible();

  const db = new PrismaClient();
  try {
    const fb = await db.feedback.findFirstOrThrow({ where: { message: NOTE }, include: { shots: true } });
    expect(fb.kind).toBe("confusing");
    expect(fb.path).toBe(`/p/${KEY}/runs`);
    expect(fb.place).toContain(NAME);
    expect(fb.shots).toHaveLength(1);
    expect(fb.shots[0].contentType).toBe("image/png");
    expect(fb.shots[0].size).toBeGreaterThan(1000);

    // A workspace admin sees everyone's, sets a status, replies and turns it into a bug.
    const admin = await browser.newPage();
    await signIn(admin, "admin@example.com");
    await admin.goto("/feedback");
    await expect(admin.getByRole("link", { name: "Everyone's feedback" })).toHaveAttribute("aria-current", "page");
    await admin.getByRole("button", { name: new RegExp(NOTE) }).click();
    const detail = admin.getByRole("region", { name: "Feedback details" });
    await expect(detail.getByText("Dana Lead", { exact: false })).toBeVisible();
    await detail.getByLabel("Status").selectOption("planned");
    await expect.poll(async () => (await db.feedback.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe("planned");
    await detail.getByLabel("Reply to Dana").fill(`Good idea, planned ${TAG}`);
    await detail.getByRole("button", { name: "Send reply" }).click();
    await expect(detail.getByRole("list", { name: "Replies" })).toContainText(`Good idea, planned ${TAG}`);
    await detail.getByRole("button", { name: "Turn into a bug" }).click();
    const bug = detail.getByTestId("feedback-bug");
    await bug.getByLabel("Test cycle").selectOption({ label: NAME });
    await bug.getByRole("button", { name: "Save the bug" }).click();
    await expect(detail.getByRole("link", { name: "Turned into a bug: see it on the Bugs page" })).toHaveAttribute("href", `/p/${KEY}/bugs`);
    const defect = await db.defect.findFirstOrThrow({ where: { project: { key: KEY } }, include: { files: true } });
    expect(defect.title).toBe(NOTE);
    expect(defect.description).toContain("From Flaw Patrol feedback (Confusing)");
    expect(defect.files).toHaveLength(1);

    // The sender gets a dot on Feedback; opening it clears the dot.
    await lead.goto(`/p/${KEY}`);
    await expect(lead.getByTestId("feedback-dot")).toBeVisible();
    // The dot is part of the button's name for screen readers.
    await lead.getByRole("button", { name: "Feedback 1 new reply to your feedback" }).click();
    await lead.getByRole("menuitem", { name: /See feedback/ }).click();
    await expect(lead.getByRole("list", { name: "Replies" })).toContainText(`Good idea, planned ${TAG}`);
    await expect.poll(async () => (await db.feedback.findUniqueOrThrow({ where: { id: fb.id } })).unseen).toBe(false);
    await lead.reload();
    await expect(lead.getByTestId("feedback-dot")).toHaveCount(0);

    // Someone else's pictures stay private.
    const tester = await browser.newPage();
    await signIn(tester, "tester@example.com");
    const res = await tester.request.get(`/api/feedback-shots/${fb.shots[0].id}`);
    expect(res.status()).toBe(404);
    await tester.goto("/feedback");
    await expect(tester.getByText(NOTE)).toHaveCount(0);

    // Just write a note, without a name: nothing ties it to the sender.
    await tester.getByRole("button", { name: "Feedback", exact: true }).click();
    await tester.getByRole("menuitem", { name: "Just write a note" }).click();
    const note = tester.getByTestId("feedback-send");
    await note.getByText("Idea", { exact: true }).click();
    await note.getByLabel("Tell us more").fill(`Anonymous idea ${TAG}`);
    await note.getByLabel("Send without my name").check();
    await note.getByRole("button", { name: "Send feedback" }).click();
    await expect(tester.getByRole("dialog", { name: "Thanks for the feedback" })).toContainText("without your name");
    const anon = await db.feedback.findFirstOrThrow({ where: { message: `Anonymous idea ${TAG}` } });
    expect(anon.userId).toBeNull();
    expect(anon.userName).toBe("");
    await admin.reload();
    await admin.getByRole("button", { name: new RegExp(`Anonymous idea ${TAG}`) }).click();
    await expect(admin.getByRole("region", { name: "Feedback details" })).toContainText("Sent without a name");
    // Nobody would see a reply, so there's no reply box.
    await expect(admin.getByRole("region", { name: "Feedback details" }).getByRole("button", { name: "Send reply" })).toHaveCount(0);
  } finally {
    await db.$disconnect();
  }
});
