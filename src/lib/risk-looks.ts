/**
 * Risk board looks (ver_201): each person picks how the Risk board looks for them in
 * Your account → Appearance. Only the drawing changes: same cards, same moves, same data.
 * The CSS for each look is in src/app/risk-looks.css, keyed on data-risk-look.
 */
export const RISK_LOOKS = [
  { id: "classic", label: "Classic", help: "The plain board. Follows light and dark mode." },
  { id: "mission", label: "Mission control", help: "A glowing heat map, like a control room screen." },
  { id: "white", label: "Whiteboard", help: "Sticky notes on a whiteboard." },
  { id: "blue", label: "Blueprint", help: "White lines on engineering blue. Diamonds show risk." },
  { id: "arcade", label: "Arcade", help: "Pixel squares and chunky borders." },
  { id: "retro", label: "80s retrowave", help: "A neon sunset heat map: pink is riskiest, cyan is safest." },
  { id: "hc", label: "High contrast", help: "Black outlines, big labels, and stripes and dots, so you never have to tell shades apart." },
] as const;

export type RiskLook = (typeof RISK_LOOKS)[number]["id"];

export const isRiskLook = (v: unknown): v is RiskLook => typeof v === "string" && RISK_LOOKS.some((l) => l.id === v);

/** Anything unknown (an old value, a typo) is Classic. */
export const cleanRiskLook = (v: unknown): RiskLook => (isRiskLook(v) ? v : "classic");

export const riskLookLabel = (v: unknown) => RISK_LOOKS.find((l) => l.id === cleanRiskLook(v))!.label;
