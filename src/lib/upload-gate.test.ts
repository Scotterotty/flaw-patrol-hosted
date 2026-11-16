import { beforeEach, describe, expect, it } from "vitest";
import { resetUploadGate, startUpload, UPLOADS_PER_HOUR, uploadSlots } from "./upload-gate";

beforeEach(() => resetUploadGate());

describe("upload limits (backend review: upload DoS)", () => {
  it("one upload at a time per person", () => {
    const a = startUpload("u1");
    expect(a.ok).toBe(true);
    const b = startUpload("u1");
    expect(b).toMatchObject({ ok: false, status: 429 });
    if (a.ok) a.done();
    expect(startUpload("u1").ok).toBe(true);
  });

  it("only a few at once on the whole server", () => {
    const gates = ["u1", "u2"].map((u) => startUpload(u, Date.now(), 2));
    expect(gates.every((g) => g.ok)).toBe(true);
    expect(startUpload("u3", Date.now(), 2)).toMatchObject({ ok: false, status: 503 });
    const first = gates[0];
    if (first.ok) {
      first.done();
      first.done(); // twice is harmless
    }
    expect(startUpload("u3", Date.now(), 2).ok).toBe(true);
    expect(startUpload("u4", Date.now(), 2).ok).toBe(false);
  });

  it("a limited number per hour", () => {
    const now = Date.now();
    for (let i = 0; i < UPLOADS_PER_HOUR; i++) {
      const g = startUpload("u1", now + i);
      expect(g.ok).toBe(true);
      if (g.ok) g.done();
    }
    const over = startUpload("u1", now + UPLOADS_PER_HOUR);
    expect(over).toMatchObject({ ok: false, status: 429 });
    if (!over.ok) expect(over.error).toMatch(/Try again in 60 minutes/);
    expect(startUpload("u1", now + 61 * 60_000).ok).toBe(true);
  });

  it("reads UPLOAD_CONCURRENCY", () => {
    expect(uploadSlots(undefined)).toBe(3);
    expect(uploadSlots("5")).toBe(5);
    expect(uploadSlots("zero")).toBe(3);
  });
});
