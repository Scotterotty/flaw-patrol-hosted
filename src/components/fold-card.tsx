"use client";

import type { ReactNode } from "react";
import { Card, cx } from "./ui";

/**
 * A card that folds to one line (ver_96): chevron, title, a one-line summary of what's
 * set inside, and an optional pill on the right. Used by the Account page, the Mini game
 * sections and "What can they do". The caller owns the open state.
 */
export function FoldCard({
  id,
  title,
  summary,
  pill,
  open,
  onToggle,
  children,
  className,
  tip,
}: {
  id?: string;
  title: ReactNode;
  summary?: ReactNode;
  pill?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  tip?: ReactNode;
}) {
  return (
    <Card id={id} className={cx("scroll-mt-20", className)}>
      <FoldHeader title={title} summary={summary} pill={pill} open={open} onToggle={onToggle} tip={tip} big />
      {open && <div className="border-t border-slate-100 p-5">{children}</div>}
    </Card>
  );
}

/** The clickable one-line header of a FoldCard, or of a smaller folding row inside a card. */
export function FoldHeader({
  title,
  summary,
  pill,
  open,
  onToggle,
  tip,
  big = false,
}: {
  title: ReactNode;
  summary?: ReactNode;
  pill?: ReactNode;
  open: boolean;
  onToggle: () => void;
  tip?: ReactNode;
  big?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-2", big ? "px-5 py-3.5" : "py-2")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span aria-hidden className={cx("inline-block flex-none text-slate-400 transition-transform", open && "rotate-90")}>
          ›
        </span>
        <span className={cx("flex-none font-semibold text-slate-800", big ? "text-sm" : "text-[13px]")}>{title}</span>
        {summary && <span className="min-w-0 truncate text-sm text-slate-500">{summary}</span>}
      </button>
      {tip}
      {pill}
    </div>
  );
}
