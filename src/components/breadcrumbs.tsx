"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { crumbsFor } from "@/lib/breadcrumbs";
import { useCrumbNames } from "./crumb-name";
import { cx } from "./ui";

export function Breadcrumbs({ project }: { project?: { key: string; name: string; group?: { id: string; name: string } | null; hub?: string } }) {
  const crumbs = crumbsFor(usePathname(), project, useCrumbNames());
  const last = crumbs.length - 1;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-slate-500">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className={cx("text-slate-300", i - 1 < last - 1 && "max-sm:hidden")}>
                ›
              </li>
            )}
            <li className={cx("min-w-0 truncate", i < last && "max-w-48 shrink-[2]", i < last - 1 && "max-sm:hidden")}>
              {i === last || !c.href ? (
                <span aria-current={i === last ? "page" : undefined} className="font-medium text-slate-800">
                  {c.label}
                </span>
              ) : (
                <Link href={c.href} className="hover:text-slate-900 hover:underline">
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
