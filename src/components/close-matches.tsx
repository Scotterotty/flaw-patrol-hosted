import { CLOSE_LABEL } from "@/lib/fuzzy";
import { cx } from "./ui";

/** The amber label above close matches, the same in every search box. */
export function CloseMatchesLabel({ className, as: Tag = "p" }: { className?: string; as?: "p" | "li" | "div" | "span" }) {
  return (
    <Tag className={cx("flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-amber-800", className)} data-testid="close-matches">
      <span className="rounded-full bg-amber-100 px-2 py-0.5">{CLOSE_LABEL}</span>
      <span aria-hidden className="h-px flex-1 bg-amber-200" />
    </Tag>
  );
}
