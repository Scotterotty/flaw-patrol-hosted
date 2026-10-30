import { PrismaClient } from "@prisma/client";
import { test } from "@playwright/test";

/**
 * Since ver_96 the OKO bug layout is a company template shared by email ending (magnopus.com).
 * Test accounts are @example.com, so a spec that picks it gets its own copy shared with
 * example.com, removed again afterwards so other specs still see a plain-only Bug template.
 */
export function useTestOko() {
  const id = `e2e_oko_${Date.now().toString(36)}`;
  test.beforeAll(async () => {
    const db = new PrismaClient();
    try {
      const seed = await db.sharedBugTemplate.findUniqueOrThrow({ where: { id: "shared_oko_layout" } });
      await db.sharedBugTemplate.create({ data: { id, name: seed.name, source: seed.source, settings: seed.settings ?? {}, domains: ["example.com"] } });
    } finally {
      await db.$disconnect();
    }
  });
  test.afterAll(async () => {
    const db = new PrismaClient();
    await db.sharedBugTemplate.deleteMany({ where: { id } }).finally(() => db.$disconnect());
  });
}
