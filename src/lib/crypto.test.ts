import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { canOpen, open, resealed, seal } from "./crypto";

const saved = { auth: process.env.AUTH_SECRET, key: process.env.ENCRYPTION_KEY };
afterEach(() => {
  process.env.AUTH_SECRET = saved.auth;
  if (saved.key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = saved.key;
});

describe("sealed secrets (backend review: encryption key split from AUTH_SECRET)", () => {
  it("without ENCRYPTION_KEY, works as before with AUTH_SECRET", () => {
    process.env.AUTH_SECRET = "auth-one";
    delete process.env.ENCRYPTION_KEY;
    const s = seal("token-123");
    expect(s.startsWith("v1.")).toBe(true);
    expect(open(s)).toBe("token-123");
    expect(resealed(s)).toBeNull();
  });

  it("with ENCRYPTION_KEY, new values survive an AUTH_SECRET change", () => {
    process.env.AUTH_SECRET = "auth-one";
    process.env.ENCRYPTION_KEY = "enc-key";
    const s = seal("token-123");
    expect(s.startsWith("v2.")).toBe(true);
    process.env.AUTH_SECRET = "auth-two";
    expect(open(s)).toBe("token-123");
  });

  it("old AUTH_SECRET values still open, and re-seal to ENCRYPTION_KEY", () => {
    process.env.AUTH_SECRET = "auth-one";
    delete process.env.ENCRYPTION_KEY;
    const old = seal("token-123");
    process.env.ENCRYPTION_KEY = "enc-key";
    expect(open(old)).toBe("token-123");
    const moved = resealed(old)!;
    expect(moved.startsWith("v2.")).toBe(true);
    process.env.AUTH_SECRET = "auth-two";
    expect(open(moved)).toBe("token-123");
    expect(canOpen(old)).toBe(false);
    expect(resealed(moved)).toBeNull();
  });

  it("a different ENCRYPTION_KEY can't open it", () => {
    process.env.AUTH_SECRET = "auth-one";
    process.env.ENCRYPTION_KEY = "enc-key";
    const s = seal("token-123");
    process.env.ENCRYPTION_KEY = "other-key";
    expect(canOpen(s)).toBe(false);
    delete process.env.ENCRYPTION_KEY;
    expect(canOpen(s)).toBe(false);
  });
});
