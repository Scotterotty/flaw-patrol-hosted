import { beforeEach, describe, expect, it, vi } from "vitest";

// Upload automation results: sign-in check and the 200 MB cap counted while reading (ver_103).

const session = { current: null as null | { user: { id: string } } };
vi.mock("@/auth", () => ({ auth: async () => session.current }));
vi.mock("@/lib/media-stage", () => ({ stageMedia: async () => "stage1" }));

const { POST } = await import("./route");

const streamedForm = (bytes: number) => {
  const boundary = "----fp";
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="junit.xml"\r\nContent-Type: text/xml\r\n\r\n`);
  return new Request("http://x/api/automation/stage", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: new ReadableStream({
      start(c) {
        c.enqueue(head);
        for (let i = 0; i < bytes; i += 1024 * 1024) c.enqueue(new Uint8Array(Math.min(1024 * 1024, bytes - i)).fill(32));
        c.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));
        c.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
};

beforeEach(() => {
  session.current = null;
});

describe("POST /api/automation/stage", () => {
  it("needs a signed-in person", async () => {
    expect((await POST(streamedForm(10))).status).toBe(401);
  });

  it("stops an upload over 200 MB even without a Content-Length", async () => {
    session.current = { user: { id: "u1" } };
    const res = await POST(streamedForm(201 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("reads a normal results file", async () => {
    session.current = { user: { id: "u1" } };
    const form = new FormData();
    form.append("file", new File([`<testsuites><testsuite name="s"><testcase name="works" classname="a" time="1"/></testsuite></testsuites>`], "junit.xml"));
    const res = await POST(new Request("http://x/api/automation/stage", { method: "POST", body: form }));
    expect(await res.json()).toMatchObject({ ok: true, tests: 1 });
  });
});
