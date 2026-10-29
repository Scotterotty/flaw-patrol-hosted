import { RARITY_LABEL, type Rarity } from "@/lib/quest";
import { cx } from "./ui";

// Quest find rarities. The label always shows with the color, so color is never the only cue.
export const RARITY_STYLE: Record<Rarity, { badge: string; ring: string; stroke: string }> = {
  common: { badge: "bg-slate-100 text-slate-700 ring-slate-200", ring: "ring-slate-300", stroke: "var(--color-slate-400)" },
  uncommon: { badge: "bg-emerald-50 text-emerald-800 ring-emerald-200", ring: "ring-emerald-400", stroke: "var(--color-emerald-500)" },
  rare: { badge: "bg-sky-50 text-sky-800 ring-sky-200", ring: "ring-sky-400", stroke: "var(--color-sky-500)" },
  epic: { badge: "bg-violet-50 text-violet-800 ring-violet-200", ring: "ring-violet-400", stroke: "var(--color-violet-500)" },
  legendary: { badge: "bg-amber-50 text-amber-800 ring-amber-300", ring: "ring-amber-400", stroke: "var(--color-amber-500)" },
  exotic: {
    badge: "bg-gradient-to-r from-pink-100 via-violet-100 to-sky-100 text-fuchsia-800 ring-fuchsia-300",
    ring: "ring-fuchsia-400",
    stroke: "var(--color-fuchsia-500)",
  },
};

export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ring-1 ring-inset", RARITY_STYLE[rarity].badge, className)}>
      {rarity === "exotic" && <span aria-hidden>✦&nbsp;</span>}
      {RARITY_LABEL[rarity]}
    </span>
  );
}
