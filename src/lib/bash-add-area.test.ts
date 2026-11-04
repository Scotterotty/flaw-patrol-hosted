import { describe, expect, it } from "vitest";
import { areaNameSchema, isNewArea, NEW_AREA_MS, parseAreas } from "./bash";

describe("areas added mid-bash (ver_169)", () => {
  it("keeps addedAt only when it's there", () => {
    const [plain, added] = parseAreas([
      { id: "a1", name: "Login", caseId: "c1", template: null, links: [] },
      { id: "a2", name: "Avatars", caseId: "c2", template: null, links: [], addedAt: "2026-11-04T20:00:00.000Z" },
    ]);
    expect(plain).not.toHaveProperty("addedAt");
    expect(added.addedAt).toBe("2026-11-04T20:00:00.000Z");
  });

  it("is New for 10 minutes", () => {
    const at = Date.parse("2026-11-04T20:00:00.000Z");
    const a = { addedAt: new Date(at).toISOString() };
    expect(isNewArea(a, at + 60_000)).toBe(true);
    expect(isNewArea(a, at + NEW_AREA_MS - 1)).toBe(true);
    expect(isNewArea(a, at + NEW_AREA_MS)).toBe(false);
    expect(isNewArea({}, at)).toBe(false);
    expect(isNewArea({ addedAt: null }, at)).toBe(false);
    expect(isNewArea({ addedAt: "not a date" }, at)).toBe(false);
  });

  it("needs a name", () => {
    expect(areaNameSchema.parse("  Voice chat ")).toBe("Voice chat");
    expect(areaNameSchema.safeParse("   ").success).toBe(false);
    expect(areaNameSchema.safeParse("x".repeat(121)).success).toBe(false);
  });
});
