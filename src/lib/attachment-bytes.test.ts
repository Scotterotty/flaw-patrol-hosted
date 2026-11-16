import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {} }));
const { byteRange } = await import("./attachment-bytes");

describe("byteRange", () => {
  it("serves the whole file with no Range, an empty one, or for an empty file", () => {
    expect(byteRange(null, 100)).toBeNull();
    expect(byteRange("bytes=-", 100)).toBeNull();
    expect(byteRange("bytes=0-10", 0)).toBeNull();
    expect(byteRange("items=0-10", 100)).toBeNull();
  });
  it("reads start-end, start- and the last N bytes", () => {
    expect(byteRange("bytes=0-", 100)).toEqual([0, 99]);
    expect(byteRange("bytes=10-19", 100)).toEqual([10, 19]);
    expect(byteRange("bytes=90-500", 100)).toEqual([90, 99]);
    expect(byteRange("bytes=-30", 100)).toEqual([70, 99]);
    expect(byteRange("bytes=-500", 100)).toEqual([0, 99]);
  });
  it("can't serve a range past the end or backwards", () => {
    expect(byteRange("bytes=100-", 100)).toBe("bad");
    expect(byteRange("bytes=50-40", 100)).toBe("bad");
  });
});
