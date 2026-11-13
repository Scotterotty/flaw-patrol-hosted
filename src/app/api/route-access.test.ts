import { beforeEach, describe, expect, it, vi } from "vitest";

// Every file and live route refuses people who may not see what they ask for: signed out gets
// 401 (or a plain Not found for profile pictures), signed in but not on the team gets Not found,
// and a team member or a workspace admin gets the data. The database is a small in-memory stand-in.

type User = { id: string; isAdmin: boolean; name: string; email: string };
const people: Record<string, User> = {
  member: { id: "member", isAdmin: false, name: "Mia", email: "mia@example.com" },
  outsider: { id: "outsider", isAdmin: false, name: "Otto", email: "otto@example.com" },
  admin: { id: "admin", isAdmin: true, name: "Ada", email: "ada@example.com" },
  guest: { id: "guest", isAdmin: false, name: "Gus", email: "gus@example.com" },
};
const me = { current: null as User | null };

const members = new Set(["p1:member"]);
const isMember = ({ where }: { where: { projectId_userId: { projectId: string; userId: string } } }) =>
  members.has(`${where.projectId_userId.projectId}:${where.projectId_userId.userId}`) ? { role: "TESTER" } : null;

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => (me.current ? { user: { id: me.current.id } } : null) }));
vi.mock("@/lib/session", () => ({ currentUser: async () => me.current }));
// Only "guest" is let into bash b1 as someone outside the team.
vi.mock("@/lib/link-access-server", () => ({ bashGuestOk: async (bashId: string, userId: string) => (bashId === "b1" && userId === "guest" ? { projectId: "p1", joined: true } : null) }));
vi.mock("@/server/bashes", () => ({ bashTick: async () => {} }));
vi.mock("@/lib/bash-live", () => ({ bashFinds: async (id: string) => (id === "b1" ? { projectId: "p1", finds: [] } : null), bashFindsVersion: async (id: string) => (id === "b1" ? { projectId: "p1", v: "v1" } : null) }));
vi.mock("@/lib/live-rows-data", () => ({ liveRowsFor: async () => [] }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "pic" ? { avatar: Buffer.from("png"), avatarType: "image/png" } : (people[where.id] ?? null),
    },
    projectMember: { findUnique: isMember, count: async () => 1 },
    joinRequest: { findMany: async () => [] },
    attachment: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "a1" ? { id: "a1", projectId: "p1", uploadedById: "someone", bashItemId: null, contentType: "image/png", fileName: "shot.png", data: Buffer.from("png") } : null,
    },
    testResult: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "r1" ? { run: { projectId: "p1", number: 3 }, entry: { title: "Login" }, attachments: [{ fileName: "a.txt", data: Buffer.from("a"), attempt: 1 }] } : null,
    },
    runEntry: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "e1" ? { status: "UNTESTED", draft: null, draftAt: null, draftByName: null, draftById: null, run: { projectId: "p1" }, results: [] } : null,
    },
    testRun: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === "run1" ? { projectId: "p1", state: "OPEN", name: "R1", entries: [] } : null),
    },
    bugBash: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === "b1" ? { projectId: "p1", endedAt: null, wrappedAt: null, people: [], items: [] } : null),
    },
  },
}));

const attachments = await import("./attachments/[id]/route");
const avatars = await import("./avatars/[id]/route");
const resultFiles = await import("./results/[id]/files/route");
const liveEntry = await import("./live/entries/[id]/route");
const liveRun = await import("./live/runs/[id]/route");
const liveBash = await import("./live/bashes/[id]/route");
const liveFinds = await import("./live/bashes/[id]/finds/route");
const liveMe = await import("./live/me/route");

const get = (route: { GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }, id: string) =>
  route.GET(new Request(`http://x/api/thing/${id}`), { params: Promise.resolve({ id }) });

const as = (who: keyof typeof people | null) => {
  me.current = who ? people[who] : null;
};

beforeEach(() => as(null));

// Each route with the id of something in project p1, and the status a signed-out request gets.
const projectRoutes = [
  { name: "attachments", route: attachments, id: "a1", signedOut: 401 },
  { name: "result files zip", route: resultFiles, id: "r1", signedOut: 401 },
  { name: "live case results", route: liveEntry, id: "e1", signedOut: 401 },
  { name: "live run", route: liveRun, id: "run1", signedOut: 401 },
  { name: "live bug bash", route: liveBash, id: "b1", signedOut: 401 },
  { name: "live bug bash finds", route: liveFinds, id: "b1", signedOut: 401 },
];

describe.each(projectRoutes)("GET $name", ({ route, id, signedOut }) => {
  it("refuses someone signed out", async () => {
    expect((await get(route, id)).status).toBe(signedOut);
  });

  it("answers Not found to someone who isn't on the team", async () => {
    as("outsider");
    expect((await get(route, id)).status).toBe(404);
  });

  it("answers Not found for something that doesn't exist", async () => {
    as("member");
    expect((await get(route, "missing")).status).toBe(404);
  });

  it("serves a team member", async () => {
    as("member");
    expect((await get(route, id)).status).toBe(200);
  });

  it("serves a workspace admin who isn't on the team", async () => {
    as("admin");
    expect((await get(route, id)).status).toBe(200);
  });
});

describe("live bug bash finds with a fingerprint", () => {
  it("sends only the fingerprint while nothing changed, and every find once it did", async () => {
    as("member");
    const ask = (v: string) => liveFinds.GET(new Request(`http://x/api/live/bashes/b1/finds?v=${v}`), { params: Promise.resolve({ id: "b1" }) });
    expect(await (await ask("v1")).json()).toEqual({ v: "v1", same: true });
    expect(await (await ask("old")).json()).toEqual({ finds: [], v: "v1" });
  });
});

describe("bug bash guests", () => {
  it("may watch the bash they were let into", async () => {
    as("guest");
    expect((await get(liveBash, "b1")).status).toBe(200);
    expect((await get(liveFinds, "b1")).status).toBe(200);
  });

  it("may not open the team's other things", async () => {
    as("guest");
    expect((await get(attachments, "a1")).status).toBe(404);
    expect((await get(resultFiles, "r1")).status).toBe(404);
    expect((await get(liveEntry, "e1")).status).toBe(404);
    expect((await get(liveRun, "run1")).status).toBe(404);
  });
});

describe("GET profile pictures", () => {
  it("answers Not found to someone signed out", async () => {
    expect((await get(avatars, "pic")).status).toBe(404);
  });

  it("serves anyone signed in", async () => {
    as("outsider");
    const res = await get(avatars, "pic");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});

describe("GET /api/live/me", () => {
  it("refuses someone signed out", async () => {
    expect((await liveMe.GET()).status).toBe(401);
  });

  it("answers someone signed in", async () => {
    as("outsider");
    expect((await liveMe.GET()).status).toBe(200);
  });
});
