// App-wide looks (ver_202): one per person, under Your account → How it looks → Appearance.
// A look only changes colors, borders and fonts; nothing moves. The CSS is in src/app/looks.css,
// keyed on data-look on <html>. Classic is the app as it always was.
import { ACCENTS, fontVars } from "./theme";

export const LOOKS = [
  { id: "classic", label: "Classic", sub: "Flaw Patrol as you know it" },
  { id: "mission", label: "Mission control", sub: "Dark screen, glowing highlights" },
  { id: "hc", label: "High contrast", sub: "Black outlines, easy-to-read font, shapes on statuses" },
  { id: "white", label: "Whiteboard", sub: "Handwritten titles, sticky notes" },
  { id: "blue", label: "Blueprint", sub: "Engineering blue, typewriter font" },
  { id: "arcade", label: "Arcade", sub: "Pixel titles, chunky borders" },
  { id: "retro", label: "80s retrowave", sub: "Neon sunset, pink grid, glowing edges" },
] as const;
export type Look = (typeof LOOKS)[number]["id"];
export const isLook = (v: unknown): v is Look => typeof v === "string" && LOOKS.some((l) => l.id === v);
export const cleanLook = (v: unknown): Look => (isLook(v) ? v : "classic");

/** Looks with their own screen color: Light and dark mode don't apply to them. */
const FIXED_MODE: Partial<Record<Look, "light" | "dark">> = { mission: "dark", blue: "dark", arcade: "dark", retro: "dark", hc: "light", white: "light" };
export const lookMode = (look: Look) => FIXED_MODE[look];

/** Fonts a look sets: body and/or heading. Handwriting and pixel fonts are on titles only. */
const LOOK_FONTS: Partial<Record<Look, { body?: string; heading?: string }>> = {
  hc: { body: "atkinson", heading: "body" },
  white: { heading: "caveat" },
  blue: { body: "mono", heading: "body" },
  arcade: { heading: "pixel" },
  // Titles only; the text font stays the person's own (Chakra Petch is an optional Text font, ver_208).
  retro: { heading: "righteous" },
};

// Blueprint's typewriter font isn't in the font lists; it's only for this look.
const MONO: Record<string, string> = { "--font-body": '"JetBrains Mono"', "--font-head": '"JetBrains Mono"', "--font-head-weight": "700", "--font-head-adjust": "none" };

const oneColor = (accent: string) => (ACCENTS.some((a) => a.id === accent) ? accent : "violet");

/**
 * The attributes and font variables on <html> for a person's choices with a look on top.
 * Used by the root layout and by the Appearance page's instant preview, so both agree.
 */
export function lookAttrs(lookIn: string | null | undefined, p: { themeMode: string; accent: string; fontBody: string; fontHeading: string; shapes: boolean }) {
  const look = cleanLook(lookIn);
  const f = LOOK_FONTS[look] ?? {};
  return {
    look,
    theme: lookMode(look) ?? p.themeMode,
    // Two- and three-color themes paint the page and bars, which would fight a look; one-color accents still tint it.
    accent: look === "classic" ? p.accent : oneColor(p.accent),
    shapes: p.shapes || look === "hc",
    fonts: f.body === "mono" ? MONO : fontVars(f.body ?? p.fontBody, f.heading ?? p.fontHeading),
  };
}
