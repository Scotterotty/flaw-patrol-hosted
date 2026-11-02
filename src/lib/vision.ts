// Color vision: status colors one person can tell apart. The palettes live in
// globals.css (data-vision on <html>); these are the choices and their swatches.

export type Vision = "standard" | "redgreen" | "blueyellow" | "none";

export const VISIONS: { id: Vision; label: string; help: string; swatch: [string, string, string, string, string] }[] = [
  { id: "standard", label: "Standard colors", help: "Green for passed, red for failed. The colors you have today.", swatch: ["#059669", "#dc2626", "#334155", "#0369a1", "#a78bfa"] },
  { id: "redgreen", label: "Red-green safe", help: "Blue for passed, orange for failed. For protanopia and deuteranopia, the most common kinds.", swatch: ["#1f6fd1", "#c94a00", "#2e2e38", "#f2c94c", "#9fb4c7"] },
  { id: "blueyellow", label: "Blue-yellow safe", help: "Teal for passed, red for failed. For tritanopia.", swatch: ["#0f8f8a", "#d7263d", "#2e2e38", "#8a5cf5", "#b8b8b8"] },
  { id: "none", label: "No color", help: "Shades of gray with shapes and patterns. For seeing no color, or grayscale screens.", swatch: ["#3f3f3f", "#0d0d0d", "#6e6e6e", "#9c9c9c", "#cfcfcf"] },
];

export const isVision = (v: unknown): v is Vision => VISIONS.some((x) => x.id === v);

/** Shapes are always on with No color; otherwise they follow the tick box. */
export const shapesOn = (vision: string, shapes: boolean) => vision === "none" || shapes;
