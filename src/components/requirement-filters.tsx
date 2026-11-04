import Link from "next/link";
import { cx } from "./ui";

// Requirements page and Risk board (ver_161): Show stories from (with two or more requirement projects)
// and the Jira release buttons, where + Add another release picks several. Plain links, so the
// address keeps the picks and can be shared.

const PILL = "rounded-md border px-2.5 py-1 text-sm";
const ON = "border-accent-600 bg-accent-50 font-medium text-accent-800";
const OFF = "border-slate-200 hover:bg-slate-50";

/** Show stories from: All projects, OW, MOB, WEB. Only with two or more requirement projects. */
export function ProjectPicker({ keys, picked, hrefFor }: { keys: string[] | null; picked: string | null; hrefFor: (proj: string | null) => string }) {
  if (!keys || keys.length < 2) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">Show stories from</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show stories from">
        {[null, ...keys].map((k) => (
          <Link key={k ?? "all"} href={hrefFor(k)} aria-current={picked === k ? "true" : undefined} className={cx(PILL, picked === k ? ON : OFF)}>
            {k ?? "All projects"}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Jira release buttons. A click picks just that release, as before. + Add another release adds more,
 * for projects that name the same release differently ("2.4" and "Web 2.4"); then × takes one off.
 */
export function ReleasePicker({
  label,
  releases,
  picked,
  hrefFor,
  limit = 8,
  withAny = false,
}: {
  label: string;
  releases: string[];
  /** null: nothing picked. "any": Any release. */
  picked: string[] | "any" | null;
  hrefFor: (picks: string[] | "any") => string;
  limit?: number;
  withAny?: boolean;
}) {
  const list = picked && picked !== "any" ? picked : [];
  const shown = [...releases.slice(0, limit), ...list.filter((r) => !releases.slice(0, limit).includes(r))];
  const more = releases.filter((r) => !list.includes(r));
  const several = list.length > 1;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
        {shown.map((r) => {
          const on = list.includes(r);
          if (on && several)
            return (
              <Link key={r} href={hrefFor(list.filter((x) => x !== r))} aria-current="true" aria-label={`${r}, remove it`} title={`Take ${r} off`} className={cx(PILL, ON)}>
                {r} <span aria-hidden>×</span>
              </Link>
            );
          return (
            <Link key={r} href={hrefFor([r])} aria-current={on ? "true" : undefined} className={cx(PILL, on ? ON : OFF)}>
              {r}
            </Link>
          );
        })}
        {withAny && (
          <Link href={hrefFor("any")} aria-current={picked === "any" ? "true" : undefined} className={cx(PILL, picked === "any" ? ON : OFF)}>
            Any release
          </Link>
        )}
        {list.length > 0 && more.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-dashed border-accent-500 px-2.5 py-1 text-sm text-accent-700 hover:bg-accent-50 [&::-webkit-details-marker]:hidden">
              + Add another release
            </summary>
            <div role="menu" aria-label="Add another release" className="absolute top-full left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-surface p-1 shadow-lg">
              {more.map((r) => (
                <Link key={r} role="menuitem" href={hrefFor([...list, r])} className="block rounded-md px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                  {r}
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
