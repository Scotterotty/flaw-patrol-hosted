import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { REPLAY_LINK_HOURS, replayToken, replayTokenFile } from "./replay-link";
import { isReplayPath, replayOrigin, viewerFrameHeaders } from "./replay-origin";

const saved = process.env.AUTH_SECRET;
afterEach(() => {
  process.env.AUTH_SECRET = saved;
});

describe("replay links for the separate trace viewer address", () => {
  it("names the file, and only while fresh", () => {
    process.env.AUTH_SECRET = "s1";
    const now = Date.now();
    const t = replayToken("att_1", now);
    expect(replayTokenFile(t, now)).toBe("att_1");
    expect(replayTokenFile(t, now + (REPLAY_LINK_HOURS * 3600 + 5) * 1000)).toBeNull();
  });

  it("refuses altered links and other servers' links", () => {
    process.env.AUTH_SECRET = "s1";
    const t = replayToken("att_1");
    const [, exp, sig] = t.split(".");
    expect(replayTokenFile(`att_2.${exp}.${sig}`)).toBeNull();
    expect(replayTokenFile(`att_1.${Number(exp) + 9999}.${sig}`)).toBeNull();
    expect(replayTokenFile("nonsense")).toBeNull();
    process.env.AUTH_SECRET = "s2";
    expect(replayTokenFile(t)).toBeNull();
  });

  it("reads the setting and the paths served there", () => {
    expect(replayOrigin(undefined)).toBeNull();
    expect(replayOrigin("https://replays.example.com/")).toBe("https://replays.example.com");
    expect(isReplayPath("/trace-viewer/index.html")).toBe(true);
    expect(isReplayPath("/api/replay/abc")).toBe(true);
    expect(isReplayPath("/account")).toBe(false);
    expect(viewerFrameHeaders("https://fp.example.com", true)["Content-Security-Policy"]).toContain("frame-ancestors https://fp.example.com");
    expect(viewerFrameHeaders(null, false)["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});
