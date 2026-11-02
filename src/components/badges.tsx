import type { CaseType, Priority, Role } from "@prisma/client";
import { PRIORITY_LABEL, TYPE_LABEL } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/permissions";
import { flakyTip } from "@/lib/run-history";
import { Badge, type Tone } from "./ui";

const PRIORITY_TONE: Record<Priority, Tone> = { CRITICAL: "red", HIGH: "orange", MEDIUM: "blue", LOW: "gray" };

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export function TypeBadge({ type }: { type: CaseType }) {
  // Automated in the same quiet gray as Manual, so automation's cases look like the rest.
  return <Badge tone={type === "EXPLORATORY" ? "blue" : "gray"}>{type === "EXPLORATORY" && <span aria-hidden>🧭&nbsp;</span>}{TYPE_LABEL[type]}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === "ADMIN" ? "violet" : role === "LEAD" ? "blue" : "gray"}>{ROLE_LABEL[role]}</Badge>;
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
          {t}
        </span>
      ))}
    </span>
  );
}

/** Amber Flaky mark; `compact` is just the ⚡ for narrow lists. */
export function FlakyBadge({ flips, compact = false }: { flips: number; compact?: boolean }) {
  const tip = flakyTip(flips);
  if (compact)
    return (
      <span title={tip} aria-label={tip} className="flex-none cursor-help text-xs text-amber-600">
        ⚡
      </span>
    );
  return (
    <span title={tip} className="inline-flex flex-none cursor-help items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-200">
      <span aria-hidden>⚡</span> Flaky
    </span>
  );
}

/** Pink Regression mark: passed last release on this platform, fails now. `tip` says where it passed. */
export function RegressionBadge({ tip, compact = false }: { tip: string; compact?: boolean }) {
  if (compact)
    return (
      <span title={tip} aria-label={`Regression. ${tip}`} className="flex-none cursor-help text-xs font-bold text-pink-600">
        !
      </span>
    );
  return (
    <span title={tip} className="inline-flex flex-none cursor-help items-center gap-0.5 rounded bg-pink-50 px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-pink-800 ring-1 ring-pink-200">
      <span aria-hidden className="font-bold">!</span> Regression
    </span>
  );
}
