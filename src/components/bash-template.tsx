"use client";

// Bug templates in bug bashes: the template's headings in Log a bug, the missing ones
// in Live finds and at wrap-up, and the tables a template keeps. Logging never waits on a
// must-have; the bug is filed once it has them.

import { useRef, useState } from "react";
import { acceptOf, deviceCell, fileAllowed, nowCell, type Answer, type BugLayout, type Section } from "@/lib/bug-layout";
import type { BashValues, FindTemplate } from "@/lib/bash-template";
import type { Seen } from "@/lib/bash";
import { Button, cx } from "./ui";

/** This person's own automatic table cells: their time, in their zone, and their browser. */
export function seenHere(): Seen {
  return { now: nowCell(), device: typeof navigator === "undefined" ? "" : deviceCell(navigator.userAgent) };
}

const typed = (s: Section) => s.source !== "empty" && s.source !== "env" && s.source !== "table";

/**
 * The headings someone fills in. `only` shows just those (what's missing); otherwise must-haves
 * show and the rest fold under Add more, unless `open`.
 */
export function TemplateFields({
  layout,
  values,
  setValues,
  only,
  open: startOpen = false,
  disabled,
  upload,
  idPrefix,
}: {
  layout: BugLayout;
  values: BashValues;
  setValues: (fn: (v: BashValues) => BashValues) => void;
  only?: string[];
  open?: boolean;
  disabled?: boolean;
  upload: (list: File[]) => Promise<{ id: string; fileName: string }[]>;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});
  const all = layout.sections.filter(typed);
  const list = only ? all.filter((s) => only.includes(s.id)) : all;
  const folded = only || startOpen ? [] : list.filter((s) => !s.must);
  const shown = open ? list : list.filter((s) => !folded.includes(s));
  const v = (id: string) => values[id] ?? { text: "", files: [] };
  const set = (id: string, patch: Partial<BashValues[string]>) => setValues((all) => ({ ...all, [id]: { ...v(id), ...all[id], ...patch } }));
  const label = (s: Section) => (
    <>
      {s.heading}
      {s.must && <span className="ml-1.5 text-[11px] font-semibold text-amber-700">Must have</span>}
    </>
  );
  return (
    <div className="space-y-2.5" data-testid="template-fields">
      {shown.map((s) => {
        const id = `${idPrefix}-${s.id}`;
        if (s.source === "choice")
          return (
            <div key={s.id} className="space-y-1">
              <p className="text-xs font-medium text-slate-700">{label(s)}</p>
              <div role="radiogroup" aria-label={s.heading} className="flex flex-wrap gap-1">
                {s.choices.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={v(s.id).text === c} disabled={disabled} onClick={() => set(s.id, { text: v(s.id).text === c ? "" : c })} className={cx("rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset", v(s.id).text === c ? "bg-accent-600 font-semibold text-white ring-accent-600" : "text-slate-700 ring-slate-200 hover:bg-slate-50")}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          );
        if (s.source === "file")
          return (
            <div key={s.id} className="space-y-1">
              <p className="text-xs font-medium text-slate-700">{label(s)}</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Button size="sm" disabled={disabled || busy === s.id} onClick={() => pickers.current[s.id]?.click()}>
                  {busy === s.id ? "Uploading…" : `Attach ${s.types ? s.types : "a file"}`}
                </Button>
                <input
                  ref={(el) => {
                    pickers.current[s.id] = el;
                  }}
                  type="file"
                  hidden
                  aria-label={`Attach ${s.heading}`}
                  accept={acceptOf(s.types) || undefined}
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])];
                    e.target.value = "";
                    const ok = files.filter((f) => fileAllowed(s.types, f.name));
                    setBad(ok.length < files.length ? `${s.heading} takes ${s.types} files.` : null);
                    if (!ok.length) return;
                    setBusy(s.id);
                    const up = await upload(ok);
                    setBusy(null);
                    set(s.id, { files: [...v(s.id).files, ...up] });
                  }}
                />
                {v(s.id).files.map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                    {f.fileName}
                    <button type="button" aria-label={`Remove ${f.fileName}`} onClick={() => set(s.id, { files: v(s.id).files.filter((x) => x.id !== f.id) })}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {s.paste && <textarea id={id} aria-label={`Or paste ${s.heading}`} rows={2} disabled={disabled} value={v(s.id).text} onChange={(e) => set(s.id, { text: e.target.value })} placeholder="Or paste the text instead" className="w-full rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm" />}
              {bad && <p className="text-xs text-red-700">{bad}</p>}
            </div>
          );
        return (
          <div key={s.id} className="space-y-1">
            <label htmlFor={id} className="block text-xs font-medium text-slate-700">
              {label(s)}
            </label>
            <textarea
              id={id}
              rows={2}
              disabled={disabled}
              value={v(s.id).text}
              onChange={(e) => set(s.id, { text: e.target.value })}
              placeholder={s.hint || (s.source === "actual" ? "Leave it empty to use your one line" : s.source === "steps" ? "1. … 2. … 3. …" : "")}
              className="w-full resize-y rounded-md border border-slate-300 bg-surface px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
            />
          </div>
        );
      })}
      {folded.length > 0 && (
        <button type="button" className="text-xs font-medium text-accent-700 hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : `Add more (${folded.length})`}
        </button>
      )}
    </div>
  );
}

/** What Flaw Patrol fills in for a bash bug, named, so people know not to type it. */
export function FilledForYou({ layout, area }: { layout: BugLayout; area: string }) {
  const tables = layout.sections.filter((s) => s.source === "table").map((s) => s.heading);
  const env = layout.sections.some((s) => s.source === "env");
  return (
    <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
      Filled in for you: the bash, area ({area}), your name{env ? ", the release, build and environment" : ""}
      {tables.length ? `, and the first row of ${tables.join(" and ")} (your time and browser)` : ""}.
    </p>
  );
}

/** "Needs 2" or "Ready", on a templated bug in Live finds and at wrap-up. */
export function NeedsTag({ t }: { t: FindTemplate | null }) {
  if (!t) return null;
  return t.needs.length ? (
    <span className="rounded bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-900" title={`Still needs ${t.needs.join(", ")}`} data-testid="needs-tag">
      Needs {t.needs.length}
    </span>
  ) : (
    <span className="rounded bg-emerald-50 px-1.5 py-px text-[11px] font-semibold text-emerald-800" data-testid="needs-tag">
      Ready
    </span>
  );
}

/** A template's tables as they stand, like Reproduction history with a row per +1. */
export function AnswerTables({ answers }: { answers: Answer[] }) {
  const tables = answers.filter((a) => a.columns && a.rows?.length);
  if (!tables.length) return null;
  return (
    <>
      {tables.map((a) => (
        <div key={a.id} className="space-y-1">
          <p className="text-xs font-medium text-slate-600">{a.heading}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-left text-slate-500">
                <tr>
                  {a.columns!.map((c) => (
                    <th key={c.name} className="px-1.5 py-1 font-medium whitespace-nowrap">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {a.rows!.map((r, i) => (
                  <tr key={i}>
                    {a.columns!.map((c, j) => (
                      <td key={c.name} className={cx("px-1.5 py-1 align-top", c.fill === "write" ? "text-slate-800" : "bg-slate-50 text-slate-600")}>
                        {r[j] || (c.fill === "files" ? "When filed" : "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
