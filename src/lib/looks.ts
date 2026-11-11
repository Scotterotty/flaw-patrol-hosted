// App-wide looks (ver_202): one per person, under Your account → How it looks → Appearance.
// A look only changes colors, borders and fonts; nothing moves. The CSS is in src/app/looks.css,
// keyed on data-look on <html>. Classic is the app as it always was.
import { ACCENTS, fontVars, type BodyFont, type HeadingFont } from "./theme";

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

/**
 * Fonts a look starts you on. Picking the look fills them into Text font and Heading font
 * (Your account → Appearance); after that your own picks win, in every look (ver_221).
 * Before ver_221 a look forced these over your picks, so the dropdowns didn't match the screen.
 */
export const LOOK_FONTS: Partial<Record<Look, { body?: BodyFont; heading?: HeadingFont }>> = {
  hc: { body: "atkinson", heading: "body" },
  white: { heading: "caveat" },
  // Blueprint's typewriter font, on titles too (they're in capitals, see looks.css).
  blue: { body: "jetbrains-mono", heading: "body" },
  arcade: { heading: "pixel" },
  // Titles only; the text font stays the person's own (Chakra Petch is an optional Text font, ver_208).
  retro: { heading: "righteous" },
};

/** Text font and Heading font for someone who hasn't picked their own. */
export const DEFAULT_FONTS = { body: "poppins", heading: "bungee" } as const;

/**
 * Your fonts after switching from one look to another. The new look's own fonts are filled in;
 * a font the old look filled in, that you never changed, goes back to the default; anything you picked yourself stays.
 */
export function fontsAfterLook(from: string | null | undefined, to: string, mine: { fontBody: string; fontHeading: string }) {
  const was = LOOK_FONTS[cleanLook(from)] ?? {};
  const next = LOOK_FONTS[cleanLook(to)] ?? {};
  return {
    fontBody: next.body ?? (was.body && mine.fontBody === was.body ? DEFAULT_FONTS.body : mine.fontBody),
    fontHeading: next.heading ?? (was.heading && mine.fontHeading === was.heading ? DEFAULT_FONTS.heading : mine.fontHeading),
  };
}

const oneColor = (accent: string) => (ACCENTS.some((a) => a.id === accent) ? accent : "violet");

/**
 * The attributes and font variables on <html> for a person's choices with a look on top.
 * Used by the root layout and by the Appearance page's instant preview, so both agree.
 */
export function lookAttrs(lookIn: string | null | undefined, p: { themeMode: string; accent: string; fontBody: string; fontHeading: string; shapes: boolean }) {
  const look = cleanLook(lookIn);
  return {
    look,
    theme: lookMode(look) ?? p.themeMode,
    // Two- and three-color themes paint the page and bars, which would fight a look; one-color accents still tint it.
    accent: look === "classic" ? p.accent : oneColor(p.accent),
    shapes: p.shapes || look === "hc",
    // Always the person's own fonts: a look only suggests fonts when it's picked (LOOK_FONTS).
    fonts: fontVars(p.fontBody, p.fontHeading),
  };
}
