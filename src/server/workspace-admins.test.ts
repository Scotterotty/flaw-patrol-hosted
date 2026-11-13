import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Workspace settings → Admins: the failsafes in the server, not just the buttons.
// The last admin can't be removed; someone who'd be locked out of sign-in needs an explicit
// "I understand" (or can't be removed at all with no other sign-in); racing removals retry.

type U = { id: string; name: string; email: string; isAdmin: boolean; passwordHash: string | null };
const users = new Map<string, U>();
const state = { me: "ada", passwordOn: true, buttons: [] as { id: string; name: string }[], projectsLost: 3, conflicts: 0 };
const log = vi.fn();

const pick = (u: U) => ({ id: u.id, name: u.name, email: u.email, isAdmin: u.isAdmin });
const userApi = {
  findUnique: async ({ where }: { where: { id: string } }) => (users.has(where.id) ? pick(users.get(where.id)!) : null),
  count: async ({ where }: { where: { isAdmin?: boolean; id?: string; passwordHash?: unknown } }) =>
    where.id ? (users.get(where.id)?.passwordHash ? 1 : 0) : [...users.values()].filter((u) => u.isAdmin).length,
  update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => Object.assign(users.get(where.id)!, data),
  findMany: async () => [],
};

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (x: unknown) => log(x) }));
vi.mock("@/auth", () => ({ passwordSignInOn: async () => state.passwordOn }));
vi.mock("@/lib/sign-in-config", () => ({ signInButtons: async () => state.buttons }));
vi.mock("./admin-guard", () => ({ requireWorkspaceAdmin: async () => users.get(state.me)! }));
vi.mock("@/lib/db", () => ({
  db: {
    user: userApi,
    project: { count: async () => state.projectsLost },
    $transaction: async (fn: (tx: { user: typeof userApi }) => unknown) => {
      if (state.conflicts > 0) {
        state.conflicts--;
        throw new Prisma.PrismaClientKnownRequestError("could not serialize", { code: "P2034", clientVersion: "x" });
      }
      return fn({ user: userApi });
    },
  },
}));

const { checkAdminRemoval, makeWorkspaceAdmin, removeWorkspaceAdmin } = await import("./workspace-admins");

const person = (id: string, isAdmin: boolean, passwordHash: string | null = null) =>
  users.set(id, { id, name: `${id[0].toUpperCase()}${id.slice(1)} Person`, email: `${id}@example.com`, isAdmin, passwordHash });

beforeEach(() => {
  users.clear();
  log.mockClear();
  Object.assign(state, { me: "ada", passwordOn: true, buttons: [], projectsLost: 3, conflicts: 0 });
  person("ada", true);
});

describe("removeWorkspaceAdmin", () => {
  it("never removes the last admin, even when asked directly", async () => {
    const r = await removeWorkspaceAdmin("ada");
    expect(r).toEqual({ ok: false, error: "You're the only workspace admin. Add another admin before you remove yourself." });
    expect(users.get("ada")!.isAdmin).toBe(true);
  });

  it("removes another admin and logs who did it", async () => {
    person("bo", true);
    expect(await removeWorkspaceAdmin("bo")).toEqual({ ok: true, self: false });
    expect(users.get("bo")!.isAdmin).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "Removed Bo Person as a workspace admin" }));
  });

  it("asks for confirmation when they'd lose password sign-in", async () => {
    person("bo", true, "hash");
    state.passwordOn = false;
    state.buttons = [{ id: "microsoft", name: "Microsoft" }];
    const r = await removeWorkspaceAdmin("bo");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Tick the box");
    expect(users.get("bo")!.isAdmin).toBe(true);
    expect(await removeWorkspaceAdmin("bo", { understoodSignIn: true })).toEqual({ ok: true, self: false });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ detail: "bo@example.com · confirmed they can sign in without a password" }));
  });

  it("refuses outright when there's no other way to sign in", async () => {
    person("bo", true, "hash");
    state.passwordOn = false;
    const r = await removeWorkspaceAdmin("bo", { understoodSignIn: true });
    expect(!r.ok && r.error).toContain("couldn't sign in at all");
    expect(users.get("bo")!.isAdmin).toBe(true);
  });

  it("tries again when two removals collide", async () => {
    person("bo", true);
    state.conflicts = 2;
    expect(await removeWorkspaceAdmin("bo")).toEqual({ ok: true, self: false });
  });
});

describe("checkAdminRemoval", () => {
  it("says what they'd lose without changing anything", async () => {
    person("bo", true, "hash");
    state.passwordOn = false;
    state.buttons = [{ id: "google", name: "Google" }];
    const r = await checkAdminRemoval("bo");
    expect(r).toEqual({ ok: true, check: { name: "Bo Person", self: false, lastAdmin: false, projectsLost: 3, signInRisk: true, signInWith: ["Google"] } });
    expect(users.get("bo")!.isAdmin).toBe(true);
  });
});

describe("makeWorkspaceAdmin", () => {
  it("only makes people with an account admins", async () => {
    expect(await makeWorkspaceAdmin("nobody")).toEqual({ ok: false, error: "That person doesn't have a Flaw Patrol account yet. Invite them to a project first." });
    person("bo", false);
    expect(await makeWorkspaceAdmin("bo")).toEqual({ ok: true, name: "Bo Person" });
    expect(users.get("bo")!.isAdmin).toBe(true);
  });
});
