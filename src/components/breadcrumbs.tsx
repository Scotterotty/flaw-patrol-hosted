"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { crumbsFor } from "@/lib/breadcrumbs";
import { useCrumbNames } from "./crumb-name";
import { cx } from "./ui";

type Crumb = { label: string; href?: string; more?: boolean; title?: string };

/**
 * Where you are, next to the logo. On a laptop a long trail folds the crumbs before the test
 * cycle into "…" (point at it to see them). On a phone it's one
 * back link, "‹ Test runs", instead of cut-off crumbs (ver_201).
 */
export function Breadcrumbs({ project }: { project?: { key: string; name: string; group?: { id: string; name: string } | null; hub?: string } }) {
  const all: Crumb[] = crumbsFor(usePathname(), project, useCrumbNames());
  const back = all.slice(0, -1).findLast((c) => c.href);
  // A long trail folds what comes before the test cycle into "…", so the cycle (it leads to its
  // Overview) and everything after it always show.
  const cycle = project ? all.findIndex((c, i) => i > 0 && c.label === project.name) : -1;
  const keepFrom = all.length > 4 ? (cycle > 1 ? cycle : Math.max(1, all.length - 3)) : 0;
  const folded = keepFrom > 0 ? all.slice(0, keepFrom) : [];
  const crumbs: Crumb[] = folded.length ? [{ label: "…", href: folded.findLast((c) => c.href)?.href, more: true, title: folded.map((c) => c.label).join(" › ") }, ...all.slice(keepFrom)] : all;
  const last = crumbs.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
        {back?.href && (
          <li className="min-w-0 truncate sm:hidden">
            <Link href={back.href} className="font-medium text-slate-700 hover:text-slate-900 hover:underline">
              ‹ {back.label}
            </Link>
          </li>
        )}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className="flex-none text-slate-300 max-sm:hidden">
                ›
              </li>
            )}
            <li
              className={cx(
                "min-w-0 truncate",
                // With a back link, a phone shows only that; with none (a top page) it shows the page name.
                (back?.href || i < last) && "max-sm:hidden",
                c.more ? "flex-none" : i === last ? "max-w-60 flex-none" : "max-w-56 shrink",
              )}
            >
              {i === last || !c.href ? (
                <span aria-current={i === last ? "page" : undefined} className="font-medium text-slate-800">
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  title={c.more ? c.title : undefined}
                  aria-label={c.more ? `More: ${c.title}` : undefined}
                  className="hover:text-slate-900 hover:underline"
                >
                  {c.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
