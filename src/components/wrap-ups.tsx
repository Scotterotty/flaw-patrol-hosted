"use client";

import { PartTitle } from "./report-part-title";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { shortDate } from "@/lib/spelling";
import { WRAP_HEADING, WRAP_NOTE, wrapLine } from "@/lib/wrap-up-text";
import type { WrapPick, WrapUp } from "@/lib/wrap-ups";
import { saveWrapUps, wrapUpChoices, type WrapScope } from "@/server/wrap-ups";
import { useSpelling } from "./spelling";
import { Button, Card, cx, ErrorText } from "./ui";

type Range = "today" | "week" | "release";

/**
 * + Attach wrap-ups (ver_96): pick bug bash reports and exploring wrap-ups to carry on
 * this report. Today comes first, made for the daily report.
 */
export function AttachWrapUps({ scope, prefKey, pick, count, release }: { scope: WrapScope; prefKey: string; pick: WrapPick; count: number; release?: string }) {
  const router = useRouter();
  const spelling = useSpelling();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("today");
  const [list, setList] = useState<WrapUp[] | null>(null);
  const [ids, setIds] = useState(pick.ids);
  const [auto, setAuto] = useState(pick.auto);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  // Props from the server are new objects after each refresh; the scope's text stays the same.
  const scopeKey = JSON.stringify(scope);
  useEffect(() => setIds(pick.ids), [pick.ids]);
  useEffect(() => {
    if (!open) return;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const week = new Date(midnight.getTime() - ((midnight.getDay() + 6) % 7) * 86_400_000);
    let live = true;
    setList(null);
    void wrapUpChoices(JSON.parse(scopeKey) as WrapScope, range === "release" ? { release } : { since: (range === "today" ? midnight : week).toISOString() }).then((r) => {
      if (!live) return;
      if (r.ok) setList(r.list);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, range, release, scopeKey]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const save = (nextIds: string[], nextAuto: boolean) => {
    setIds(nextIds);
    setAuto(nextAuto);
    start(async () => {
      const r = await saveWrapUps({ key: prefKey, ids: nextIds, auto: nextAuto });
      if (!r.ok) return setError(r.error);
      router.refresh();
    });
  };
  return (
    <div className="relative" ref={box} data-export-skip="">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        + Attach wrap-ups{count > 0 && ` (${count})`}
      </Button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-surface p-3 shadow-lg" role="dialog" aria-label="Attach wrap-ups to this report">
          <p className="mb-2 text-sm font-semibold text-slate-900">Attach wrap-ups to this report</p>
          <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="When">
            {(
              [
                ["today", "Today"],
                ["week", "This week"],
                ...(release ? [["release", "This release"] as const] : []),
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={range === id} onClick={() => setRange(id)} className={cx("rounded-full px-2.5 py-0.5 text-xs", range === id ? "bg-accent-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
                {label}
              </button>
            ))}
          </div>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {list === null ? (
            <p className="py-3 text-sm text-slate-500">Loading…</p>
          ) : list.length === 0 ? (
            <p className="py-3 text-sm text-slate-500">No bug bashes or exploring {range === "today" ? "today" : range === "week" ? "this week" : "in this release"} yet.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {list.map((w) => {
                const on = ids.includes(w.id);
                return (
                  <li key={w.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" className="mt-1 accent-accent-600" checked={on} disabled={pending} onChange={() => save(on ? ids.filter((x) => x !== w.id) : [...ids, w.id], auto)} />
                      <span className="min-w-0">
                        <span className="mr-1 text-xs font-medium text-slate-500">{w.type === "bash" ? "🐞 Bug bash" : "🧭 Exploratory"}</span>
                        <span className="font-medium text-slate-900">{w.title}</span>
                        <span className="block text-xs text-slate-500">
                          {shortDate(new Date(w.at), spelling)} · {wrapLine(w)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {release && (
            <label className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 text-sm text-slate-700">
              <input type="checkbox" className="accent-accent-600" checked={auto} disabled={pending} onChange={(e) => save(ids, e.target.checked)} />
              Attach new ones from this release automatically
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** The attached wrap-ups as their own section, under the report. */
export function WrapUpsSection({ items }: { items: WrapUp[] }) {
  const spelling = useSpelling();
  if (!items.length) return null;
  return (
    <Card className="mt-5 p-5" data-testid="wrap-ups">
      <PartTitle part="wrapups" className="mb-3" title={WRAP_HEADING}>
        {WRAP_HEADING} <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{WRAP_NOTE}</span>
      </PartTitle>
      <ul className="divide-y divide-slate-100">
        {items.map((w) => (
          <li key={w.id} className="py-2.5 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{w.title}</span>
              <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", w.type === "bash" ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-teal-50 text-teal-800 ring-teal-200")}>{w.type === "bash" ? "🐞 Bug bash" : "🧭 Exploratory"}</span>
              <Link href={w.href} className="ml-auto text-xs text-accent-700 hover:underline">
                {w.type === "bash" ? "Bash report →" : "Run →"}
              </Link>
            </p>
            <p className="mt-0.5 text-xs text-slate-600">
              {shortDate(new Date(w.at), spelling)} · {wrapLine(w)}
            </p>
            {w.worst && <p className="mt-0.5 text-xs text-slate-600">Worst: {w.worst}</p>}
            {w.summary && <p className="mt-1 text-sm text-slate-700 italic">&ldquo;{w.summary}&rdquo;</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
