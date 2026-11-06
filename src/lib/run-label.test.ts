import { describe, expect, it } from "vitest";
import { runTag, runTitle, versionText } from "./run-label";

describe("run labels (ver_189: the version, never R1)", () => {
  it("puts a v before a build that starts with a number", () => {
    expect(versionText("2.4.2")).toBe("v2.4.2");
    expect(versionText(" 2.4.2 (812) ")).toBe("v2.4.2 (812)");
    expect(versionText("Nightly 1102")).toBe("Nightly 1102");
    expect(versionText("")).toBe("");
    expect(versionText(null)).toBe("");
  });
  it("names a run by its version, a hotfix by its own", () => {
    expect(runTitle({ name: "Smoke test", build: "2.4.1" })).toBe("Smoke test v2.4.1");
    expect(runTitle({ name: "Smoke test", build: "2.4.2" })).toBe("Smoke test v2.4.2");
  });
  it("shows the day it started when there's no version, unless the name says it", () => {
    const at = new Date("2026-11-06T18:00:00Z");
    expect(runTag({ name: "Smoke test", build: "", createdAt: at })).toBe("Nov 6");
    expect(runTag({ name: "Smoke test", build: "", createdAt: at }, "uk")).toBe("6 Nov");
    expect(runTag({ name: "Smoke test Nov 6", build: "", createdAt: at })).toBe("");
    expect(runTitle({ name: "Smoke test Nov 6", build: "", createdAt: at })).toBe("Smoke test Nov 6");
    expect(runTag({ name: "Checkout 2026-11-06", build: "", createdAt: at })).toBe("");
  });
});
