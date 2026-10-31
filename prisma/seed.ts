// Demo data so the app has something to click through: one project, a folder
// tree, shared steps with parameters and a handful of cases. Safe to re-run;
// it skips if the demo project already exists.
import { randomBytes } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import pkg from "../package.json";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient();
// Demo people start with this build's What's new marked seen, like any new account.
const BUILD = Number(pkg.version.split(".").pop()) || 0;

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").toLowerCase();
  if (await db.project.findUnique({ where: { key: "SHOP" } })) {
    console.log("Demo project SHOP already exists, nothing to do.");
    return;
  }
  // A first password can only come from an invite or password link, so the demo
  // people get one here: SEED_PASSWORD if set (the e2e tests set it), else a random one.
  const password = process.env.SEED_PASSWORD || randomBytes(9).toString("base64url");
  const pw = { passwordHash: await hashPassword(password), passwordSetAt: new Date() };
  const admin = await db.user.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, name: "Demo Admin", isAdmin: true, whatsNewSeen: BUILD, ...pw },
    update: { isAdmin: true },
  });
  const lead = await db.user.upsert({ where: { email: "lead@example.com" }, create: { email: "lead@example.com", name: "Dana Lead", whatsNewSeen: BUILD, ...pw }, update: {} });
  const tester = await db.user.upsert({ where: { email: "tester@example.com" }, create: { email: "tester@example.com", name: "Sam Tester", whatsNewSeen: BUILD, ...pw }, update: {} });

  const project = await db.project.create({
    data: {
      key: "SHOP",
      name: "Web storefront",
      description: "Customer-facing shop: browsing, cart, checkout and accounts.",
      members: {
        create: [
          { userId: admin.id, role: "ADMIN" },
          { userId: lead.id, role: "LEAD" },
          { userId: tester.id, role: "TESTER" },
        ],
      },
    },
  });

  const folder = async (name: string, parentId: string | null = null) =>
    (await db.folder.create({ data: { projectId: project.id, name, parentId } })).id;
  const accounts = await folder("Accounts");
  const login = await folder("Login", accounts);
  const checkout = await folder("Checkout");
  const payments = await folder("Payments", checkout);
  const catalog = await folder("Catalog");

  const author = { authorId: admin.id, authorName: "Demo Admin" };
  const shared = async (name: string, description: string, parameters: { name: string; defaultValue: string }[], steps: { action: string; expected: string }[]) =>
    (
      await db.sharedStep.create({
        data: {
          projectId: project.id,
          name,
          description,
          versions: {
            create: {
              version: 1,
              name,
              description,
              parameters: parameters as Prisma.InputJsonValue,
              steps: steps as Prisma.InputJsonValue,
              ...author,
            },
          },
        },
      })
    ).id;

  const logIn = await shared("Log in as {{role}}", "Signs in through the login page with a seeded test account.", [{ name: "role", defaultValue: "customer" }], [
    { action: "Open /login", expected: "Login form is shown" },
    { action: "Enter the {{role}} test account email and password, press Sign in", expected: "Redirected to the home page, signed in as {{role}}" },
  ]);
  const addToCart = await shared("Add {{product}} to cart", "", [{ name: "product", defaultValue: "Blue T-shirt" }], [
    { action: "Search for {{product}} and open its page", expected: "Product page shows price and stock" },
    { action: "Press Add to cart", expected: "Cart badge count goes up by 1" },
  ]);

  let n = 0;
  const testCase = async (c: {
    folderId: string;
    title: string;
    priority: Prisma.TestCaseCreateInput["priority"];
    tags: string[];
    preconditions?: string;
    type?: "MANUAL" | "AUTOMATED";
    automationId?: string;
    steps: Prisma.InputJsonValue[];
  }) => {
    n += 1;
    const sharedIds = c.steps.flatMap((s) => (s && typeof s === "object" && "sharedStepId" in s ? [String(s.sharedStepId)] : []));
    await db.testCase.create({
      data: {
        projectId: project.id,
        number: n,
        folderId: c.folderId,
        title: c.title,
        priority: c.priority,
        tags: c.tags,
        preconditions: c.preconditions ?? "",
        type: c.type ?? "MANUAL",
        automationId: c.automationId ?? null,
        versions: {
          create: {
            version: 1,
            title: c.title,
            priority: c.priority!,
            tags: c.tags,
            preconditions: c.preconditions ?? "",
            type: c.type ?? "MANUAL",
            automationId: c.automationId ?? null,
            steps: c.steps,
            changeNote: "Created",
            ...author,
          },
        },
        sharedUsages: { create: [...new Set(sharedIds)].map((sharedStepId) => ({ sharedStepId })) },
      },
    });
  };
  const step = (action: string, expected: string) => ({ kind: "step", action, expected });

  await testCase({
    folderId: login,
    title: "Customer can log in with email and password",
    priority: "CRITICAL",
    tags: ["smoke", "auth"],
    steps: [{ kind: "shared", sharedStepId: logIn, params: {} }, step("Open My account", "Account page shows the customer's name and orders")],
  });
  await testCase({
    folderId: login,
    title: "Wrong password shows an error and keeps the email",
    priority: "HIGH",
    tags: ["auth"],
    steps: [step("Open /login", "Login form is shown"), step("Enter a valid email and a wrong password, press Sign in", "Error “Email or password is incorrect”; email field keeps its value")],
  });
  await testCase({
    folderId: login,
    title: "Account locks after 5 failed attempts",
    priority: "HIGH",
    tags: ["auth", "security"],
    steps: [step("Fail to log in 5 times with the same email", "5th attempt shows “Account locked, check your email”"), step("Try the correct password", "Still locked")],
  });
  await testCase({
    folderId: payments,
    title: "Checkout with a saved card",
    priority: "CRITICAL",
    tags: ["smoke", "checkout"],
    preconditions: "Customer test account has a saved Visa ending 4242.",
    steps: [
      { kind: "shared", sharedStepId: logIn, params: {} },
      { kind: "shared", sharedStepId: addToCart, params: { product: "Red Mug" } },
      step("Open the cart and press Checkout", "Checkout shows the saved card selected"),
      step("Press Place order", "Order confirmation with an order number; confirmation email arrives"),
    ],
  });
  await testCase({
    folderId: payments,
    title: "Declined card shows a retry message",
    priority: "HIGH",
    tags: ["checkout"],
    steps: [
      { kind: "shared", sharedStepId: addToCart, params: {} },
      step("Check out with test card 4000 0000 0000 0002", "“Your card was declined” and the order is not created"),
    ],
  });
  await testCase({
    folderId: checkout,
    title: "Admin can refund an order",
    priority: "MEDIUM",
    tags: ["admin"],
    steps: [{ kind: "shared", sharedStepId: logIn, params: { role: "admin" } }, step("Open a paid order and press Refund", "Order status is Refunded; customer gets an email")],
  });
  await testCase({
    folderId: catalog,
    title: "Search returns matching products",
    priority: "MEDIUM",
    tags: ["search"],
    type: "AUTOMATED",
    automationId: "catalog.search.matches",
    steps: [step("Search for “mug”", "Only products with “mug” in the name or description are listed")],
  });
  await testCase({
    folderId: catalog,
    title: "Out-of-stock products can't be added to the cart",
    priority: "LOW",
    tags: ["catalog"],
    steps: [step("Open an out-of-stock product", "Add to cart is disabled and shows “Out of stock”")],
  });

  await db.project.update({ where: { id: project.id }, data: { caseSeq: n } });
  console.log(`Seeded project SHOP with ${n} cases. Sign in as ${adminEmail}${process.env.SEED_PASSWORD ? " with SEED_PASSWORD" : ` with the password ${password}`} to look around.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
