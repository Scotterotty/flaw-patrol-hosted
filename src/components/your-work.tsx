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

const cases = (n: number) => `${n} ${n === 1 ? "case" : "cases"}`;
const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** Runs with cases waiting for the viewer: the top few, and the rest one click away. */
export function YourWork({ rows, open: savedOpen }: { rows: YourWorkRow[]; open: boolean }) {
  const [open, setOpen] = useState(savedOpen);
  const firstNew = useRef<HTMLAnchorElement>(null);
  const [focusNew, setFocusNew] = useState(false);
  useEffect(() => {
    if (focusNew) {
      firstNew.current?.focus();
      setFocusNew(false);
    }
  }, [focusNew]);
  if (rows.length === 0) return null;
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
      <span className="inline-block px-4 text-sm text-slate-500 sm:px-0" data-testid="your-work-total">
        {cases(total)} waiting in {runs(rows.length)}
      </span>
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
    </Card>
  );
}
