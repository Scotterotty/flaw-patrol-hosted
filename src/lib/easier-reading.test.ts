import { describe, expect, it } from "vitest";
import { ASK_AGAIN_MS, nextReadingAsk, readingBannerDue } from "./easier-reading";

const now = new Date("2026-11-16T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("readingBannerDue", () => {
  it("asks people who haven't answered, unless it's already on", () => {
    expect(readingBannerDue({ easierReading: false, readingAsk: "", readingAskAt: null }, now)).toBe(true);
    expect(readingBannerDue({ easierReading: true, readingAsk: "", readingAskAt: null }, now)).toBe(false);
  });
  it("asks once more two weeks after Not now, and never after no", () => {
    expect(readingBannerDue({ easierReading: false, readingAsk: "later", readingAskAt: ago(ASK_AGAIN_MS - 60_000) }, now)).toBe(false);
    expect(readingBannerDue({ easierReading: false, readingAsk: "later", readingAskAt: ago(ASK_AGAIN_MS + 60_000) }, now)).toBe(true);
    expect(readingBannerDue({ easierReading: false, readingAsk: "done", readingAskAt: ago(ASK_AGAIN_MS * 10) }, now)).toBe(false);
  });
});

describe("nextReadingAsk", () => {
  it("treats a second Not now as no, for good", () => {
    expect(nextReadingAsk("", "later")).toBe("later");
    expect(nextReadingAsk("later", "later")).toBe("done");
    expect(nextReadingAsk("", "done")).toBe("done");
  });
});
