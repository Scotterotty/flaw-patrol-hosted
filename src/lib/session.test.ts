import { beforeEach, describe, expect, it, vi } from "vitest";

// The checks every page and server action leans on (src/lib/session.ts): signed out goes to
// Sign in, people not on the team are refused, and each role may do only what the Roles card allows.

type Row = { id: string; isAdmin: boolean; email: string; name: string };
const people: Record<string, Row> = {
  viewer: { id: "viewer", isAdmin: false, email: "v@example.com", name: "Vi" },
  tester: { id: "tester", isAdmin: false, email: "t@example.com", name: "Tess" },
  lead: { id: "lead", isAdmin: false, email: "l@example.com", name: "Lee" },
  outsider: { id: "outsider", isAdmin: false, email: "o@example.com", name: "Otto" },
  admin: { id: "admin", isAdmin: true, email: "a@example.com", name: "Ada" },
};
const roles: Record<string, string> = { viewer: "VIEWER", tester: "TESTER", lead: "LEAD" };
const me = { id: null as string | null };

class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}
class NotFound extends Error {}

vi.mock("server-only", () => ({}));
vi.mock("react", async (real) => ({ ...(await real<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock("@/auth", () => ({ auth: async () => (me.id ? { user: { id: me.id } } : null) }));
vi.mock("./link-access-server", () => ({ bashGuestOk: async () => null, currentPath: async () => "/p/QA/cases" }));
const project = { id: "p1", key: "QA", name: "QA", groupId: null, roleRules: null, keepMembersSeparate: false };
vi.mock("./db", () => ({
  db: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => people[where.id] ?? null },
    projectMember: {
      findUnique: async ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) => {
        const role = where.projectId_userId.projectId === "p1" ? roles[where.projectId_userId.userId] : undefined;
        return role ? { role } : null;
      },
    },
    project: {
      findUniqueOrThrow: async () => project,
      findUnique: async ({ where, include }: { where: { key?: string; id?: string }; include?: unknown }) => {
        if (where.key && where.key !== "QA") return null;
        if (!include) return project;
        const role = me.id ? roles[me.id] : undefined;
        return { ...project, members: role ? [{ role }] : [], hubOf: null, group: null };
      },
    },
    projectGroup: { findFirst: async () => null },
  },
}));

const { Forbidden, projectAccess, requireProjectAction, requireUser } = await import("./session");

const as = (who: keyof typeof people | null) => {
  me.id = who;
};
const refusal = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

beforeEach(() => as(null));

describe("requireUser", () => {
  it("sends someone signed out to Sign in", async () => {
    expect(await refusal(requireUser())).toMatchObject({ to: "/signin" });
  });

  it("gives back the signed-in person", async () => {
    as("tester");
    expect((await requireUser()).id).toBe("tester");
  });
});

describe("requireProjectAction (server actions)", () => {
  it("sends someone signed out to Sign in before anything else", async () => {
    expect(await refusal(requireProjectAction("p1", "run:execute"))).toBeInstanceOf(Redirect);
  });

  it("refuses someone who isn't on the team", async () => {
    as("outsider");
    expect(await refusal(requireProjectAction("p1", "run:execute"))).toBeInstanceOf(Forbidden);
    expect(await refusal(requireProjectAction("p1", "bash:join"))).toBeInstanceOf(Forbidden);
  });

  it("lets a Viewer do only what Viewers may", async () => {
    as("viewer");
    expect(await refusal(requireProjectAction("p1", "case:edit"))).toBeInstanceOf(Forbidden);
    expect(await refusal(requireProjectAction("p1", "run:execute"))).toBeInstanceOf(Forbidden);
    expect(await refusal(requireProjectAction("p1", "run:delete"))).toBeInstanceOf(Forbidden);
    expect((await requireProjectAction("p1", "bash:join")).role).toBe("VIEWER");
    expect((await requireProjectAction("p1", "case:flag")).role).toBe("VIEWER");
  });

  it("lets a Tester test and write cases but not manage members or delete runs", async () => {
    as("tester");
    expect((await requireProjectAction("p1", "case:edit")).role).toBe("TESTER");
    expect((await requireProjectAction("p1", "run:execute")).role).toBe("TESTER");
    expect(await refusal(requireProjectAction("p1", "members:manage"))).toBeInstanceOf(Forbidden);
    expect(await refusal(requireProjectAction("p1", "run:delete"))).toBeInstanceOf(Forbidden);
  });

  it("keeps Members and roles for admins only, even for a Lead", async () => {
    as("lead");
    expect(await refusal(requireProjectAction("p1", "members:manage"))).toBeInstanceOf(Forbidden);
  });

  it("lets a workspace admin do anything, team member or not", async () => {
    as("admin");
    expect((await requireProjectAction("p1", "members:manage")).role).toBe("ADMIN");
    expect((await requireProjectAction("p1", "run:delete")).role).toBe("ADMIN");
  });
});

describe("projectAccess (pages)", () => {
  it("sends someone signed out to Sign in", async () => {
    expect(await refusal(projectAccess("QA"))).toMatchObject({ to: "/signin" });
  });

  it("answers Not found for a project that doesn't exist", async () => {
    as("tester");
    expect(await refusal(projectAccess("NOPE"))).toBeInstanceOf(NotFound);
  });

  it("sends someone not on the team to Ask to join, not into the project", async () => {
    as("outsider");
    const e = await refusal(projectAccess("QA"));
    expect(e).toBeInstanceOf(Redirect);
    expect((e as Redirect).to).toBe(`/access?to=${encodeURIComponent("/p/QA/cases")}`);
  });

  it("opens the project for a member with their role", async () => {
    as("viewer");
    expect((await projectAccess("QA")).role).toBe("VIEWER");
  });

  it("opens the project for a workspace admin as Admin", async () => {
    as("admin");
    expect((await projectAccess("QA")).role).toBe("ADMIN");
  });
});
