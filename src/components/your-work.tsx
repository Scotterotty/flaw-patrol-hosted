"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { YOUR_WORK_COOKIE, YOUR_WORK_SHORT } from "@/lib/project-list";
import { buttonClass, Card } from "./ui";

export type YourWorkRow = {
  href: string;
  run: string;
  number: number;
  cycle: string;
  left: number;
  started: boolean;
};

/** A bug bash you were in, wrapped up this week: your own finds are one click away (ver_169). */
export type YourBashRow = { id: string; name: string; finds: number; href: string };

const cases = (n: number) => `${n} ${n === 1 ? "case" : "cases"}`;
const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** Runs with cases waiting for the viewer: the top few, and the rest one click away. */
export function YourWork({ rows, bashes = [], open: savedOpen }: { rows: YourWorkRow[]; bashes?: YourBashRow[]; open: boolean }) {
  const [open, setOpen] = useState(savedOpen);
  const firstNew = useRef<HTMLAnchorElement>(null);
  const [focusNew, setFocusNew] = useState(false);
  useEffect(() => {
    if (focusNew) {
      firstNew.current?.focus();
      setFocusNew(false);
    }
  }, [focusNew]);
  if (rows.length === 0 && bashes.length === 0) return null;
  const long = rows.length > YOUR_WORK_SHORT;
  const shown = open || !long ? rows : rows.slice(0, YOUR_WORK_SHORT);
  const total = rows.reduce((n, r) => n + r.left, 0);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.cookie = `${YOUR_WORK_COOKIE}=${next ? "all" : "short"}; path=/; max-age=31536000; samesite=lax`;
    if (next) setFocusNew(true);
  };
  return (
    <Card className="ring-accent-500/30">
      {/* Heading and total sit right in the card, so the card is the heading's parent. */}
      <h2 className="inline-block pt-3 pr-3 pl-4 text-sm font-semibold text-slate-900">Your work</h2>
      {rows.length > 0 && (
        <span className="inline-block px-4 text-sm text-slate-500 sm:px-0" data-testid="your-work-total">
          {cases(total)} waiting in {runs(rows.length)}
        </span>
      )}
      <ul className="divide-y divide-slate-100" id="your-work-rows">
        {shown.map((w, i) => (
          <li key={w.href} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="font-medium text-slate-900">{w.run}</span>
              <span className="text-sm text-slate-500">
                {" "}
                · {w.cycle} · Run {w.number} · {cases(w.left)} waiting
              </span>
            </span>
            <Link
              ref={i === YOUR_WORK_SHORT ? firstNew : undefined}
              href={w.href}
              className={buttonClass(i === 0 ? "primary" : "secondary", "sm")}
            >
              Test my cases<span className="sr-only"> in {w.run}</span>
            </Link>
          </li>
        ))}
      </ul>
      {long && (
        <div className="border-t border-slate-100 px-4 py-2">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="your-work-rows"
            className="text-sm font-medium text-accent-600 hover:underline"
          >
            {open ? "Show fewer" : `Show all ${runs(rows.length)}`}
          </button>
        </div>
      )}
      {bashes.length > 0 && (
        // Only your own finds, never anyone else's counts. Gone a week after the wrap-up.
        <ul className="divide-y divide-slate-100 border-t border-slate-100" data-testid="your-bashes">
          {bashes.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span aria-hidden="true">🐞 </span>
                <span className="font-medium text-slate-900">{b.name}</span>
                <span className="text-sm text-slate-500">
                  {" "}
                  · {b.finds ? `you logged ${b.finds} ${b.finds === 1 ? "find" : "finds"}` : "you joined this bug bash"}
                </span>
              </span>
              <Link href={b.href} className={buttonClass("secondary", "sm")}>
                See results<span className="sr-only"> of {b.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
