import { beforeEach, describe, expect, it, vi } from "vitest";

// The sign-in form's first step (security fix, ver_103): an existing account without a
// password is sent to its invite or password link instead of a "choose a password" step.

const users = new Map<string, { passwordHash: string | null; isAdmin: boolean }>();

vi.mock("@/auth", () => ({
  mayJoin: async (email: string) => users.size === 0 || email.endsWith("@allowed.com"),
  passwordSignInOn: async () => true,
  signIn: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: async ({ where }: { where: { email: string } }) => users.get(where.email) ?? null, count: async () => users.size } },
}));
vi.mock("next-auth", () => ({ AuthError: class extends Error {} }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/invites", () => ({}));
vi.mock("@/lib/mail", () => ({}));
vi.mock("@/lib/session", () => ({}));

const { checkEmail } = await import("./passwords");

beforeEach(() => users.clear());

describe("checkEmail", () => {
  it("asks for the password when the account has one", async () => {
    users.set("pat@example.com", { passwordHash: "x", isAdmin: false });
    expect(await checkEmail("Pat@Example.com")).toEqual({ ok: true, next: "password" });
  });

  it("sends an existing account without a password to its invite link", async () => {
    users.set("admin@example.com", { passwordHash: "x", isAdmin: true });
    users.set("invited@example.com", { passwordHash: null, isAdmin: false });
    const res = await checkEmail("invited@example.com");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("Use the invite link in your email");
  });

  it("lets a brand-new person from an allowed domain choose a password", async () => {
    users.set("admin@example.com", { passwordHash: "x", isAdmin: true });
    expect(await checkEmail("new@allowed.com")).toEqual({ ok: true, next: "create" });
    expect((await checkEmail("new@elsewhere.com")).ok).toBe(false);
  });
});
