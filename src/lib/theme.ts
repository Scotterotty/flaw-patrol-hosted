// Each person's appearance. The accent hues live in src/app/globals.css.
export const THEME_MODES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match my computer" },
] as const;

export const ACCENTS = [
  { id: "violet", label: "Flaw Patrol", hue: 295 },
  { id: "ocean", label: "Ocean", hue: 255 },
  { id: "teal", label: "Lagoon", hue: 195 },
  { id: "forest", label: "Forest", hue: 150 },
  { id: "rose", label: "Rose", hue: 12 },
  { id: "sunset", label: "Sunset", hue: 45 },
] as const;

/** Multi-color themes (CSS in globals.css). Swatches: [page, panels] or [bars, page, panels]. */
export const THEMES = [
  { id: "peach", label: "Peach & Periwinkle", sub: "Peach page, periwinkle bars and panels", colors: 2, light: ["#fbe3d1", "#f1f2ff"], dark: ["#2b1a10", "#1a1d36"] },
  { id: "butter", label: "Butter & Lilac", sub: "Butter page, lilac bars and panels", colors: 2, light: ["#f9eecb", "#f5efff"], dark: ["#231d0a", "#1e1730"] },
  { id: "quartz", label: "Rose Quartz & Ice", sub: "Dusty rose page, icy teal bars and panels", colors: 2, light: ["#f3d9df", "#ecf7f7"], dark: ["#28131a", "#132426"] },
  { id: "denim", label: "Denim & Linen", sub: "Denim page, linen bars and panels", colors: 2, light: ["#d4def0", "#fbf7ef"], dark: ["#0e1729", "#221e17"] },
  { id: "harbor", label: "Harbor", sub: "Navy bars, sand page, white panels", colors: 3, light: ["#1d3557", "#f0e6d6", "#ffffff"], dark: ["#0e1a2e", "#17130c", "#1c2432"] },
  { id: "grape", label: "Grape & Apricot", sub: "Grape bars, apricot page, cream panels", colors: 3, light: ["#3a1f63", "#fbe5d4", "#fffcf8"], dark: ["#1f1236", "#1f140c", "#251c33"] },
  { id: "lagoon", label: "Lagoon & Coral", sub: "Deep teal bars, coral page, sea-white panels", colors: 3, light: ["#0f4c55", "#fbe2d8", "#f6fbfb"], dark: ["#082c31", "#23120d", "#13272a"] },
  { id: "graphite", label: "Graphite & Saffron", sub: "Graphite bars, saffron page, white panels", colors: 3, light: ["#2a2e35", "#faedcd", "#ffffff"], dark: ["#15171b", "#201a09", "#23252a"] },
] as const;
export type MultiTheme = (typeof THEMES)[number]["id"];

// Text size scales everything sized in rem, which is the whole interface.
export const TEXT_SIZES = [
  { id: "90", label: "Small" },
  { id: "100", label: "Standard" },
  { id: "112", label: "Large" },
  { id: "125", label: "Larger" },
  { id: "150", label: "Largest" },
] as const;
export type TextSize = (typeof TEXT_SIZES)[number]["id"];
export const isTextSize = (v: string): v is TextSize => TEXT_SIZES.some((t) => t.id === v);

export type ThemeMode = (typeof THEME_MODES)[number]["id"];
/** One-color accents and the multi-color themes share the one setting. */
export type Accent = (typeof ACCENTS)[number]["id"] | MultiTheme;

export const isThemeMode = (v: string): v is ThemeMode => THEME_MODES.some((m) => m.id === v);
export const isAccent = (v: string): v is Accent => ACCENTS.some((a) => a.id === v) || THEMES.some((t) => t.id === v);

// Fonts are bundled (open-source, via @fontsource, imported in src/app/layout.tsx)
// and only downloaded when someone uses them. Every font can be a heading font;
// those with a `text` note are also readable enough for everything else.
// `weight` is the weight headings use; `adjust` evens out very small or wide
// display fonts (CSS font-size-adjust).
type FontDef = {
  id: string;
  label: string;
  family: string;
  group: FontGroup;
  weight: number;
  text?: string;
  adjust?: number;
};

export const FONT_GROUPS = ["Flaw Patrol", "Easy reading", "Open Foundry", "Fun"] as const;
export type FontGroup = (typeof FONT_GROUPS)[number];

export const FONTS = [
  { id: "poppins", label: "Poppins", family: '"Poppins"', group: "Flaw Patrol", weight: 600, text: "Flaw Patrol's text font" },
  { id: "bungee", label: "Bungee", family: '"Bungee"', group: "Flaw Patrol", weight: 400 },
  { id: "young-serif", label: "Young Serif", family: '"Young Serif"', group: "Flaw Patrol", weight: 400 },

  { id: "inter", label: "Inter", family: '"Inter"', group: "Easy reading", weight: 700, text: "Compact, fits more on screen" },
  { id: "atkinson", label: "Atkinson Hyperlegible", family: '"Atkinson Hyperlegible Next"', group: "Easy reading", weight: 700, text: "Easy to tell similar letters apart" },
  { id: "lexend", label: "Lexend", family: '"Lexend"', group: "Easy reading", weight: 600, text: "Wider spacing, for reading ease" },
  { id: "opendyslexic", label: "OpenDyslexic", family: '"OpenDyslexic"', group: "Easy reading", weight: 700, text: "Weighted letters, for dyslexia" },
  { id: "open-sans", label: "Open Sans", family: '"Open Sans"', group: "Easy reading", weight: 700, text: "Friendly, very readable" },
  { id: "dm-sans", label: "DM Sans", family: '"DM Sans"', group: "Easy reading", weight: 700, text: "Crisp and modern" },
  { id: "lato", label: "Lato", family: '"Lato"', group: "Easy reading", weight: 700, text: "Warm and steady" },
  { id: "system", label: "System", family: "system-ui", group: "Easy reading", weight: 600, text: "Your computer's own font" },

  { id: "archivo", label: "Archivo", family: '"Archivo"', group: "Open Foundry", weight: 700, text: "Sturdy grotesque" },
  { id: "work-sans", label: "Work Sans", family: '"Work Sans"', group: "Open Foundry", weight: 600, text: "Clean and open" },
  { id: "roboto", label: "Roboto", family: '"Roboto"', group: "Open Foundry", weight: 700, text: "Familiar from Android" },
  { id: "cooper-hewitt", label: "Cooper Hewitt", family: '"Cooper Hewitt"', group: "Open Foundry", weight: 700, text: "Narrow museum sans" },
  { id: "aileron", label: "Aileron", family: '"Aileron"', group: "Open Foundry", weight: 700, text: "Swiss-style neutral" },
  { id: "libre-baskerville", label: "Libre Baskerville", family: '"Libre Baskerville"', group: "Open Foundry", weight: 700, text: "Bookish serif" },
  { id: "eb-garamond", label: "EB Garamond", family: '"EB Garamond"', group: "Open Foundry", weight: 600, text: "Classic old-style serif" },
  { id: "oswald", label: "Oswald", family: '"Oswald"', group: "Open Foundry", weight: 600 },
  { id: "league-gothic", label: "League Gothic", family: '"League Gothic"', group: "Open Foundry", weight: 400 },
  { id: "ostrich-sans", label: "Ostrich Sans", family: '"Ostrich Sans"', group: "Open Foundry", weight: 900 },
  { id: "bluu-next", label: "Bluu Next", family: '"Bluu Next"', group: "Open Foundry", weight: 700 },
  { id: "bagnard", label: "Bagnard", family: '"Bagnard"', group: "Open Foundry", weight: 400 },

  { id: "nunito", label: "Nunito", family: '"Nunito"', group: "Fun", weight: 700, text: "Soft and rounded" },
  { id: "quicksand", label: "Quicksand", family: '"Quicksand"', group: "Fun", weight: 700, text: "Light and friendly" },
  { id: "comic-neue", label: "Comic Neue", family: '"Comic Neue"', group: "Fun", weight: 700, text: "Comic style, but tidy" },
  { id: "space-grotesk", label: "Space Grotesk", family: '"Space Grotesk"', group: "Fun", weight: 700, text: "Quirky and techy" },
  { id: "chakra-petch", label: "Chakra Petch", family: '"Chakra Petch"', group: "Fun", weight: 700, text: "Angled 80s tech letters" },
  { id: "courier-prime", label: "Courier Prime", family: '"Courier Prime"', group: "Fun", weight: 700, text: "Typewriter" },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: '"JetBrains Mono"', group: "Fun", weight: 700, text: "Blueprint's code-style letters" },
  { id: "fraunces", label: "Fraunces", family: '"Fraunces"', group: "Fun", weight: 600 },
  { id: "playfair", label: "Playfair Display", family: '"Playfair Display"', group: "Fun", weight: 700 },
  { id: "bricolage", label: "Bricolage Grotesque", family: '"Bricolage Grotesque"', group: "Fun", weight: 700 },
  { id: "fredoka", label: "Fredoka", family: '"Fredoka"', group: "Fun", weight: 600 },
  { id: "righteous", label: "Righteous", family: '"Righteous"', group: "Fun", weight: 400 },
  { id: "lobster", label: "Lobster", family: '"Lobster"', group: "Fun", weight: 400 },
  { id: "caveat", label: "Caveat", family: '"Caveat"', group: "Fun", weight: 700, adjust: 0.5 },
  { id: "pixel", label: "Press Start 2P", family: '"Press Start 2P"', group: "Fun", weight: 400, adjust: 0.4 },
] as const satisfies readonly FontDef[];

export type FontId = (typeof FONTS)[number]["id"];
const byId = new Map<string, FontDef>(FONTS.map((f) => [f.id, f]));
export const fontFor = (id: string) => byId.get(id);

export const BODY_FONTS = FONTS.filter((f): f is Extract<(typeof FONTS)[number], { text: string }> => "text" in f);
export type BodyFont = (typeof BODY_FONTS)[number]["id"];
/** Any font, or "body" to use the text font for headings too. */
export type HeadingFont = FontId | "body";

export const isBodyFont = (v: string): v is BodyFont => !!fontFor(v)?.text;
export const isHeadingFont = (v: string): v is HeadingFont => v === "body" || byId.has(v);

/** CSS variables for a person's fonts, set on <html> (see globals.css). */
export function fontVars(body: string, heading: string): Record<string, string> {
  const b = isBodyFont(body) ? fontFor(body)! : fontFor("poppins")!;
  const h = heading === "body" ? null : (fontFor(heading) ?? fontFor("bungee")!);
  return {
    "--font-body": b.family,
    "--font-head": h ? h.family : "var(--font-body)",
    "--font-head-weight": String(h ? h.weight : b.weight),
    "--font-head-adjust": h?.adjust ? String(h.adjust) : "none",
  };
}
