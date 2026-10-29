import Link from "next/link";
import { cx } from "@/components/ui";

/** Tabs that switch which part of a list you are looking at (Active / Closed, Active / Archived). */
export function ViewTabs({ label, tabs }: { label: string; tabs: { label: string; href: string; count?: number; current: boolean }[] }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
            t.current ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cx("rounded-full px-1.5 text-xs tabular-nums", t.current ? "bg-accent-100 text-accent-700" : "bg-slate-100 text-slate-600")}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
