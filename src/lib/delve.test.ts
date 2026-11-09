import { describe, expect, it } from "vitest";
import { codeStep } from "@/components/delve-door";
import { cleanKeys, dungeonLabel, MAX_SAVE_BYTES } from "./delve";

const CODE = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Shift", "Shift"];
const run = (keys: string[]) => keys.reduce((at, k) => codeStep(at, k), 0);

describe("hidden page door", () => {
  it("opens on the whole code, with B and A in either case", () => {
    expect(run(CODE)).toBe(12);
    expect(run(CODE.map((k) => (k.length === 1 ? k.toUpperCase() : k)))).toBe(12);
  });
  it("starts over on a wrong key, and a stray Up still counts as the start", () => {
    expect(run(CODE.slice(0, 5).concat(["x"]))).toBe(0);
    expect(run(["ArrowUp", "ArrowUp", "ArrowUp", ...CODE.slice(2)])).toBe(0);
    expect(run(["x", ...CODE])).toBe(12);
    // Enter instead of the two Shifts doesn't open it.
    expect(run([...CODE.slice(0, 10), "Enter", "Enter"])).toBe(0);
  });
});

describe("hidden page save", () => {
  it("keeps only the game's own keys as text", () => {
    expect(cleanKeys({ "delve.meta": "{}", "delve.run.2": "{}", other: "x", "delve.bad": 3 })).toEqual({ "delve.meta": "{}", "delve.run.2": "{}" });
    expect(cleanKeys(null)).toBeNull();
    expect(cleanKeys(["delve.meta"])).toBeNull();
  });
  it("refuses a save that's too big", () => {
    expect(cleanKeys({ "delve.meta": "x".repeat(MAX_SAVE_BYTES) })).toBeNull();
  });
});

describe("dungeon names", () => {
  const at = new Date("2026-11-06T18:00:00Z");
  it("shows where it was tested and the version, then the run", () => {
    expect(dungeonLabel({ name: "RC 23", build: "2.4.2", createdAt: at }, "Unity")).toBe("Unity v2.4.2 · RC 23");
  });
  it("falls back to the run's own title when there's no version", () => {
    expect(dungeonLabel({ name: "Smoke", build: "", createdAt: at }, "Web")).toBe("Web · Smoke Nov 6");
  });
});
