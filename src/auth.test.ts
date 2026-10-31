import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/lib/password";

// Password sign-in rules (security fix, ver_103), with an in-memory stand-in for the database.

type User = { id: string; email: string; name: string | null; isAdmin: boolean; passwordHash: string | null; failedLogins: number; lockedUntil: Date | null };
const state = { users: [] as User[], passwordSignIn: true };

vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
  CredentialsSignin: class extends Error {
    code = "";
  },
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (c: unknown) => c }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/sign-in-config", () => ({
  buildProviders: () => [],
  COMPANY_PROVIDERS: [],
  domainList: (s?: string | null) => (s ?? "").split(",").map((d) => d.trim()).filter(Boolean),
  emailInDomains: (email: string, domains: string[]) => domains.some((d) => email.endsWith(`@${d}`)),
  emailTrusted: () => true,
  PROVIDER_NAME: {},
  savedProviders: async () => [],
}));
vi.mock("@/lib/db", () => {
  const find = (email: string) => state.users.find((u) => u.email === email) ?? null;
  return {
    db: {
      user: {
        findUnique: async ({ where }: { where: { email?: string; id?: string } }) => (where.email ? find(where.email) : (state.users.find((u) => u.id === where.id) ?? null)),
        count: async () => state.users.length,
        create: async ({ data }: { data: Partial<User> & { email: string } }) => {
          const u = { id: `u${state.users.length + 1}`, name: null, isAdmin: false, passwordHash: null, failedLogins: 0, lockedUntil: null, ...data } as User;
          state.users.push(u);
          return u;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => Object.assign(state.users.find((u) => u.id === where.id)!, data),
      },
      workspace: { findUnique: async () => ({ passwordSignIn: state.passwordSignIn, joinDomains: "allowed.com" }) },
      activityEntry: { findFirst: async () => null, update: vi.fn() },
      passwordLink: { updateMany: vi.fn() },
    },
  };
});

const { authorizePassword, mayJoin } = await import("./auth");

const problem = (p: Promise<unknown>) => p.then(() => "signed in", (e: { code?: string }) => e.code ?? String(e));

async function person(email: string, password: string | null, extra: Partial<User> = {}) {
  state.users.push({ id: `u${state.users.length + 1}`, email, name: null, isAdmin: false, passwordHash: password ? await hashPassword(password) : null, failedLogins: 0, lockedUntil: null, ...extra });
}

beforeEach(() => {
  state.users = [];
  state.passwordSignIn = true;
});

describe("first password", () => {
  it("can't be chosen on the sign-in page for an existing account without a password", async () => {
    await person("admin@example.com", "admin password 1", { isAdmin: true });
    await person("invited@example.com", null);
    expect(await problem(authorizePassword({ email: "invited@example.com", password: "attacker password", mode: "create" }))).toBe("no-password");
    expect(state.users.find((u) => u.email === "invited@example.com")!.passwordHash).toBeNull();
  });

  it("can't take over a workspace admin who only uses company sign-in, even with password sign-in off", async () => {
    await person("first@example.com", "first password 1");
    await person("sso-admin@example.com", null, { isAdmin: true });
    state.passwordSignIn = false;
    expect(await problem(authorizePassword({ email: "sso-admin@example.com", password: "attacker password", mode: "create" }))).toBe("no-password");
    expect(state.users.find((u) => u.email === "sso-admin@example.com")!.passwordHash).toBeNull();
  });

  it("an admin with a password can still sign in when password sign-in is off; others can't", async () => {
    await person("admin@example.com", "admin password 1", { isAdmin: true });
    await person("member@example.com", "member password 1");
    state.passwordSignIn = false;
    expect(await problem(authorizePassword({ email: "admin@example.com", password: "admin password 1" }))).toBe("signed in");
    expect(await problem(authorizePassword({ email: "member@example.com", password: "member password 1" }))).toBe("sso-only");
  });

  it("the very first person makes an account and becomes admin", async () => {
    expect(await problem(authorizePassword({ email: "first@example.com", password: "first password 1", mode: "create" }))).toBe("signed in");
    expect(state.users[0]).toMatchObject({ email: "first@example.com", isAdmin: true });
  });

  it("a brand-new person from an allowed domain can join; others can't", async () => {
    await person("admin@example.com", "admin password 1", { isAdmin: true });
    expect(await problem(authorizePassword({ email: "new@allowed.com", password: "new person pw 1", mode: "create" }))).toBe("signed in");
    expect(await problem(authorizePassword({ email: "new@elsewhere.com", password: "new person pw 1", mode: "create" }))).toBe("not-invited");
    expect(await mayJoin("x@allowed.com")).toBe(true);
  });
});

describe("password sign-in", () => {
  it("signs in with the right password and refuses a wrong one", async () => {
    await person("pat@example.com", "pat password 1");
    expect(await problem(authorizePassword({ email: "pat@example.com", password: "pat password 1" }))).toBe("signed in");
    expect(await problem(authorizePassword({ email: "pat@example.com", password: "nope nope nope" }))).toBe("wrong");
    expect(await problem(authorizePassword({ email: "nobody@example.com", password: "pat password 1" }))).toBe("wrong");
  });

  it("locks after 10 wrong tries and unlocks after 15 minutes", async () => {
    await person("pat@example.com", "pat password 1");
    for (let i = 0; i < 9; i++) expect(await problem(authorizePassword({ email: "pat@example.com", password: "wrong password" }))).toBe("wrong");
    expect(await problem(authorizePassword({ email: "pat@example.com", password: "wrong password" }))).toBe("locked");
    expect(await problem(authorizePassword({ email: "pat@example.com", password: "pat password 1" }))).toBe("locked");
    state.users[0].lockedUntil = new Date(Date.now() - 1000);
    expect(await problem(authorizePassword({ email: "pat@example.com", password: "pat password 1" }))).toBe("signed in");
  });
});
