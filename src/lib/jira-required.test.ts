import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { JiraClient, jiraMessage, needsMessage, requiredName, type MetaField } from "./jira";

const field = (id: string, name: string, later = false): MetaField => ({ id, name, required: true, schema: { type: "string" }, options: [], later });

/** A client whose Jira wants Team and Bug Impact on every new bug. */
function client(meta: MetaField[]) {
  const c = new JiraClient({ siteUrl: "https://x.atlassian.net", email: "a@b.c", token: "t", jiraProjectKey: "OW", issueType: "Bug" } as never);
  const stub = c as unknown as Record<string, unknown>;
  stub.severityField = async () => null;
  stub.fieldMeta = async () => meta;
  stub.priorityName = async () => null;
  stub.stakeholderPriority = () => null;
  stub.me = async () => null;
  return c;
}

function jira(required: Record<string, string>) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      const { fields } = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
      sent.push(fields);
      const missing = Object.entries(required).filter(([id]) => !(id in fields));
      if (missing.length) {
        const errors = Object.fromEntries(missing.map(([id, name]) => [id, `${name} is required.`]));
        return new Response(JSON.stringify({ errorMessages: missing.map(([, n]) => `${n}: ${n} is required.`), errors }), { status: 400 });
      }
      return new Response(JSON.stringify({ key: "OW-1" }), { status: 201 });
    }
    return new Response(null, { status: 204 });
  });
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("Jira says a field is required (Nov 10)", () => {
  it("says each complaint once", () => {
    expect(jiraMessage(["Team: Team is required.", "Bug Impact: Bug Impact is required."], { a: "Team is required.", b: "Bug Impact is required." })).toBe("Team is required. Bug Impact is required.");
    expect(jiraMessage(["Something else broke."], {})).toBe("Something else broke.");
  });

  it("reads the field name out of Jira's words", () => {
    expect(requiredName("Build #: Build # is required.")).toBe("Build #");
    expect(requiredName("Client/SKUs is required.")).toBe("Client/SKUs");
    expect(requiredName("Field 'x' cannot be set.")).toBeNull();
    expect(needsMessage(["Bug Impact"])).toBe("Jira needs Bug Impact before it will take this bug. Fill it in and try again.");
    expect(needsMessage(["Team", "Bug Impact", "Build #"])).toBe("Jira needs Team, Bug Impact and Build # before it will take this bug. Fill them in and try again.");
  });

  it("keeps the fields that were filled in and names only the empty one", async () => {
    const sent = jira({ t: "Team", i: "Bug Impact" });
    const c = client([field("t", "Team"), field("i", "Bug Impact")]);
    const err = await c.createIssue({ summary: "s", description: () => ({}), severity: "MAJOR" as never, fields: { t: { name: "Team", value: "Web" } } }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Jira needs Bug Impact before it will take this bug. Fill it in and try again.");
    // Team was never stripped out to "try again".
    expect(sent.every((f) => f.t === "Web")).toBe(true);
  });

  it("sends a filled-in field while creating when Jira wants it there", async () => {
    const sent = jira({ i: "Bug Impact" });
    const c = client([field("i", "Bug Impact", true)]);
    const r = await c.createIssue({ summary: "s", description: () => ({}), severity: "MAJOR" as never, fields: { i: { name: "Bug Impact", value: "Everyone" } } });
    expect(r.key).toBe("OW-1");
    expect(sent.at(-1)?.i).toBe("Everyone");
  });
});
