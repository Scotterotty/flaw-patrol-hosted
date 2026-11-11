import { describe, expect, it } from "vitest";
import { fontsAfterLook, lookAttrs } from "./looks";

// ver_221: a look fills in its fonts when picked; after that the person's own picks win.
const base = { themeMode: "system", accent: "violet", shapes: false };

describe("lookAttrs", () => {
  it("always draws the person's own fonts, whatever the look", () => {
    for (const look of ["classic", "retro", "arcade", "white", "hc", "blue"]) {
      const f = lookAttrs(look, { ...base, fontBody: "chakra-petch", fontHeading: "bungee" }).fonts;
      expect(f["--font-body"], look).toBe('"Chakra Petch"');
      expect(f["--font-head"], look).toBe('"Bungee"');
    }
  });
});

describe("fontsAfterLook", () => {
  const mine = { fontBody: "chakra-petch", fontHeading: "bungee" };
  it("fills in the new look's own fonts", () => {
    expect(fontsAfterLook("classic", "retro", mine)).toEqual({ fontBody: "chakra-petch", fontHeading: "righteous" });
    expect(fontsAfterLook("classic", "hc", mine)).toEqual({ fontBody: "atkinson", fontHeading: "body" });
    expect(fontsAfterLook("classic", "blue", mine)).toEqual({ fontBody: "jetbrains-mono", fontHeading: "body" });
  });
  it("leaves fonts alone for a look without its own", () => {
    expect(fontsAfterLook("classic", "mission", mine)).toEqual(mine);
  });
  it("puts back the default for a font the old look filled in and nobody changed", () => {
    expect(fontsAfterLook("retro", "classic", { fontBody: "chakra-petch", fontHeading: "righteous" })).toEqual({ fontBody: "chakra-petch", fontHeading: "bungee" });
    expect(fontsAfterLook("hc", "mission", { fontBody: "atkinson", fontHeading: "body" })).toEqual({ fontBody: "poppins", fontHeading: "bungee" });
  });
  it("keeps a font the person picked after choosing the look", () => {
    expect(fontsAfterLook("retro", "classic", mine)).toEqual(mine);
    expect(fontsAfterLook("retro", "mission", mine)).toEqual(mine);
  });
});
