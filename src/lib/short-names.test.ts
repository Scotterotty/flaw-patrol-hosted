import { describe, expect, it } from "vitest";
import { shortNames } from "./short-names";

describe("shortNames", () => {
  it("uses first names, You for me, and a last initial when two share a first name", () => {
    const m = shortNames(
      [
        { id: "1", name: "Dana Lead" },
        { id: "2", name: "Sam Tester" },
        { id: "3", name: "Sam Kim" },
        { id: "4", name: "Demo Admin" },
        { id: "5", name: "nina@example.com" },
      ],
      "4",
    );
    expect(m.get("1")).toBe("Dana");
    expect(m.get("2")).toBe("Sam T.");
    expect(m.get("3")).toBe("Sam K.");
    expect(m.get("4")).toBe("You");
    expect(m.get("5")).toBe("nina");
  });
});
