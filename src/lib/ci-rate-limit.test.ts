import { describe, expect, it, vi } from "vitest";

// CI token rate limit counted in the database (security build B, finding #6).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { ciRateLimited, CI_MAX_PER_WINDOW, CI_WINDOW_MS } = await import("./ci-rate-limit");

type Hit = { id: string; tokenId: string; at: Date };
type Where = { tokenId: string; at: { lt?: Date; gte?: Date } };

/** A tiny stand-in for the CiTokenHit table, shared like the real one would be. */
function table() {
  let rows: Hit[] = [];
  let n = 0;
  const match = (r: Hit, w: Where) => r.tokenId === w.tokenId && (!w.at.lt || r.at < w.at.lt) && (!w.at.gte || r.at >= w.at.gte);
  const ciTokenHit = {
    deleteMany: async ({ where }: { where: Where }) => {
      const before = rows.length;
      rows = rows.filter((r) => !match(r, where));
      return { count: before - rows.length };
    },
    create: async ({ data }: { data: { tokenId: string; at: Date } }) => {
      const row = { id: String(++n), ...data };
      rows.push(row);
      return { id: row.id };
    },
    count: async ({ where }: { where: Where }) => rows.filter((r) => match(r, where)).length,
    delete: async ({ where }: { where: { id: string } }) => {
      rows = rows.filter((r) => r.id !== where.id);
      return {};
    },
  };
  return { store: { ciTokenHit } as never, rows: () => rows };
}

describe("ciRateLimited", () => {
  const t0 = new Date("2026-10-31T00:00:00Z");
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it("allows 20 uploads a minute and refuses the 21st", async () => {
    const { store } = table();
    for (let i = 0; i < CI_MAX_PER_WINDOW; i++) expect(await ciRateLimited("t1", at(i), store)).toBe(false);
    expect(await ciRateLimited("t1", at(100), store)).toBe(true);
  });

  it("counts each token on its own", async () => {
    const { store } = table();
    for (let i = 0; i < CI_MAX_PER_WINDOW; i++) await ciRateLimited("t1", at(i), store);
    expect(await ciRateLimited("t2", at(100), store)).toBe(false);
  });

  it("lets uploads through again once the minute has passed, and clears old hits", async () => {
    const { store, rows } = table();
    for (let i = 0; i < CI_MAX_PER_WINDOW; i++) await ciRateLimited("t1", at(i), store);
    expect(await ciRateLimited("t1", at(CI_WINDOW_MS + 50), store)).toBe(false);
    expect(rows().length).toBe(1);
  });

  it("doesn't count refused uploads", async () => {
    const { store, rows } = table();
    for (let i = 0; i < CI_MAX_PER_WINDOW + 5; i++) await ciRateLimited("t1", at(i), store);
    expect(rows().length).toBe(CI_MAX_PER_WINDOW);
  });

  it("holds when uploads arrive at the same moment (shared by every server)", async () => {
    const { store } = table();
    const results = await Promise.all(Array.from({ length: 30 }, () => ciRateLimited("t1", at(0), store)));
    expect(results.filter((r) => !r).length).toBeLessThanOrEqual(CI_MAX_PER_WINDOW);
  });
});
