"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useMenuPlace } from "./menu-place";
import { addPartToReport, createCustomReport } from "@/server/custom-reports";
import type { PartId } from "@/lib/report-parts";
import { Button, cx, Input } from "./ui";

// "+ Add to report" on every box of the Reports tabs (ver_101), and the same boxes' headings
// inside a custom report, where the heading can be renamed and shows which tab it came from.

export type AddTarget = { id: string; name: string; parts: number; shared: boolean };
type AddCtx = { projectId: string; reports: AddTarget[]; base: string };
type FrameCtx = { heading: string; from: string; own: string | null; actions?: ReactNode };

const Add = createContext<AddCtx | null>(null);
const Frame = createContext<FrameCtx | null>(null);

/** Wraps a Reports tab: the reports its boxes can be added to. Leave it out and no button shows. */
export function AddToReportProvider({ projectId, reports, base, children }: AddCtx & { children: ReactNode }) {
  return <Add.Provider value={{ projectId, reports, base }}>{children}</Add.Provider>;
}

/** Wraps one part inside a custom report: its heading (maybe renamed) and where it came from. */
export function PartFrame({ children, ...v }: FrameCtx & { children: ReactNode }) {
  return <Frame.Provider value={v}>{children}</Frame.Provider>;
}

/**
 * A box's heading. On a Reports tab it gets + Add to report; inside a custom report it shows the
 * heading people gave it and a tag with the tab it came from. `quiet`: boxes with no heading of
 * their own (rows of numbers) only show the button on the tab.
 */
export function PartTitle({ part, children, className, quiet, title }: { part: PartId; children: ReactNode; className?: string; quiet?: boolean; title?: string }) {
  const frame = useContext(Frame);
  if (frame)
    return (
      <div className={cx("flex flex-wrap items-center gap-2", quiet ? "mb-2" : className)} data-part-title="">
        <h2 className="text-sm font-semibold text-slate-800" data-part-heading="">
          {frame.heading}
        </h2>
        <span className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-500" data-export-skip="">
          {frame.from}
        </span>
        {frame.own && (
          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 text-[11px] text-amber-800" data-testid="own-filters">
            {frame.own}
          </span>
        )}
        {frame.actions && <span className="ml-auto">{frame.actions}</span>}
      </div>
    );
  if (quiet)
    return (
      <div className="mb-1.5 flex justify-end">
        <AddToReport part={part} title={title ?? String(children)} />
      </div>
    );
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <h2 className="text-sm font-semibold text-slate-800">{children}</h2>
      <span className="ml-auto">
        <AddToReport part={part} title={title ?? String(children)} />
      </span>
    </div>
  );
}

/** The button and its little menu: pick a report, or name a new one. */
export function AddToReport({ part, title }: { part: PartId; title: string }) {
  const ctx = useContext(Add);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const place = useMenuPlace(open, box, list);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!ctx) return null;

  const done = (r: { ok: true; id: string; name: string } | { ok: false; error: string }) => {
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setOpen(false);
    setName("");
    setMsg({ ok: true, text: `Added to ${r.name}`, href: `${ctx.base}/${r.id}` });
    router.refresh();
  };
  const addTo = (id: string) => start(async () => done(await addPartToReport(ctx.projectId, id, part)));
  const addNew = () =>
    start(async () => {
      if (!name.trim()) return;
      done(await createCustomReport(ctx.projectId, { name, part, query: window.location.search }));
    });

  return (
    <div ref={box} className="relative inline-block" data-export-skip="">
      <Button size="sm" variant="ghost" className="h-6 px-2 text-accent-700 ring-1 ring-accent-200 ring-inset hover:bg-accent-50" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)} data-testid={`add-${part}`}>
        + Add to report
      </Button>
      {open && (
      <div ref={list} role="menu" style={place} className={cx("absolute top-full right-0 z-30 mt-1 w-72 rounded-lg border border-slate-200 bg-surface p-1 text-sm shadow-lg")}>
        <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-slate-500">Add &ldquo;{title}&rdquo; to…</p>
        {ctx.reports.map((r) => (
          <button key={r.id} type="button" role="menuitem" disabled={pending} onClick={() => addTo(r.id)} className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-slate-50">
            <span className="truncate">{r.name}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {r.parts} {r.parts === 1 ? "part" : "parts"}
              {!r.shared && " · only you"}
            </span>
          </button>
        ))}
        {ctx.reports.length > 0 && <hr className="my-1 border-slate-100" />}
        <form
          className="flex gap-1.5 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addNew();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New report name" aria-label="New report name" className="h-7 text-xs" maxLength={80} />
          <Button size="sm" variant="primary" type="submit" disabled={pending || !name.trim()}>
            Add
          </Button>
        </form>
      </div>
      )}
      {msg && (
        <div role="status" className={cx("fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 text-sm shadow-lg ring-1", msg.ok ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-red-50 text-red-800 ring-red-200")} data-testid="add-to-report-note">
          {msg.ok ? "✓ " : ""}
          {msg.text}
          {msg.href && (
            <Link href={msg.href} className="font-medium text-accent-700 underline">
              Open it
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
