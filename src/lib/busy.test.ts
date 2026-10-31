import { describe, expect, it } from "vitest";
import { busyLabel, opensHere, requestKind } from "./busy";

describe("corner spinner helpers", () => {
  it("counts saves and page loads, not prefetches or polls", () => {
    expect(requestKind({ "Next-Action": "abc" })).toBe("action");
    expect(requestKind(new Headers({ RSC: "1" }))).toBe("page");
    expect(requestKind({ RSC: "1", "Next-Router-Prefetch": "1" })).toBeNull();
    expect(requestKind({ accept: "application/json" })).toBeNull();
    expect(requestKind(undefined)).toBeNull();
    expect(requestKind([["rsc", "1"]])).toBe("page");
  });
  it("names what it's doing", () => {
    expect(busyLabel({ kind: "link", text: "  Test runs " })).toBe("Opening Test runs…");
    expect(busyLabel({ kind: "link", text: "" })).toBe("Opening…");
    expect(busyLabel({ kind: "link", text: "Test cases 12" })).toBe("Opening Test cases…");
    expect(busyLabel({ kind: "link", text: "Test runs 2 active" })).toBe("Opening Test runs…");
    expect(busyLabel({ kind: "link", text: "R14 Web smoke\nPassed 3 of 4" })).toBe("Opening R14 Web smoke…");
    expect(busyLabel({ kind: "link", text: "x".repeat(60) })).toBe(`Opening ${"x".repeat(39)}…`);
    expect(busyLabel({ kind: "button", text: "Save and next" })).toBe("Saving…");
    expect(busyLabel({ kind: "button", text: "Import 40 cases" })).toBe("Importing…");
    expect(busyLabel({ kind: "button", text: "Mark all passed" })).toBe("Working…");
    expect(busyLabel(null)).toBe("Working…");
  });
  it("only follows plain clicks to another page on this site", () => {
    const here = { href: "http://fp.test/p/WEB/cases?x=1", origin: "http://fp.test" };
    expect(opensHere({ href: "/p/WEB/runs" }, here, {})).toBe(true);
    expect(opensHere({ href: "/p/WEB/cases?x=2" }, here, {})).toBe(true);
    expect(opensHere({ href: "/p/WEB/cases?x=1#top" }, here, {})).toBe(false);
    expect(opensHere({ href: "/p/WEB/runs" }, here, { ctrl: true })).toBe(false);
    expect(opensHere({ href: "/p/WEB/runs", target: "_blank" }, here, {})).toBe(false);
    expect(opensHere({ href: "/export.csv", download: true }, here, {})).toBe(false);
    expect(opensHere({ href: "https://github.com/x" }, here, {})).toBe(false);
    expect(opensHere({ href: "mailto:a@b.c" }, here, {})).toBe(false);
  });
});
