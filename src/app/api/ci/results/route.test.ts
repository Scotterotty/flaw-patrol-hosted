import { describe, expect, it, vi } from "vitest";

// CI uploads: token checks and the 200 MB cap counted while reading (ver_103).

vi.mock("@/lib/db", () => ({
  db: {
    ciToken: { findUnique: async ({ where }: { where: { hash: string } }) => (where.hash === "good" ? { id: "t1", groupId: "g1", name: "CI", group: { id: "g1", name: "OKO", archivedAt: null, hubProjectId: null } } : null) },
    project: { findMany: async () => [] },
  },
}));
vi.mock("@/lib/ci-token", () => ({ CI_PREFIX: "fp_ci_", ciHash: (t: string) => (t === "fp_ci_good" ? "good" : "bad") }));
const limited = vi.fn(async () => false);
vi.mock("@/lib/ci-rate-limit", () => ({ ciRateLimited: () => limited() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/result", () => ({ UserError: class extends Error {} }));
vi.mock("@/lib/automation-save", () => ({ saveAutomationRun: vi.fn() }));

const { POST } = await import("./route");

const post = (token: string | null, body?: BodyInit) =>
  POST(new Request("http://x/api/ci/results", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body, duplex: "half" } as RequestInit));

describe("POST /api/ci/results", () => {
  it("refuses a missing or wrong token", async () => {
    expect((await post(null)).status).toBe(401);
    expect((await post("fp_ci_bad")).status).toBe(401);
  });

  it("answers 429 when the token is over its limit", async () => {
    limited.mockResolvedValueOnce(true);
    expect((await post("fp_ci_good")).status).toBe(429);
  });

  it("stops an upload over 200 MB even without a Content-Length", async () => {
    const big = new ReadableStream({
      start(c) {
        for (let i = 0; i < 201; i++) c.enqueue(new Uint8Array(1024 * 1024));
        c.close();
      },
    });
    expect((await post("fp_ci_good", big)).status).toBe(413);
  });
});
