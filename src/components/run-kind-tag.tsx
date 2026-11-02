import { EXPLORE_KIND, kindIcon, kindLabel, type RunKindDef } from "@/lib/run-kinds";
import { cx } from "./ui";

/** A run's kind as a small tag: 🧭 Exploratory, 🐞 Bug bash, Release candidate, Run… */
export function RunKindTag({ kinds, kind, live = false, className }: { kinds: RunKindDef[]; kind: string; live?: boolean; className?: string }) {
  const icon = kindIcon(kind);
  return (
    <span
      data-testid="kind-tag"
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        kind === EXPLORE_KIND ? "bg-teal-50 text-teal-800 ring-teal-200" : kind === "bash" ? "bg-rose-50 text-rose-800 ring-rose-200" : kind === "rc" ? "bg-accent-50 text-accent-800 ring-accent-200" : "bg-slate-100 text-slate-700 ring-slate-200",
        className,
      )}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {kindLabel(kinds, kind)}
      {live && (
        <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white" />
          Live
        </span>
      )}
    </span>
  );
}
