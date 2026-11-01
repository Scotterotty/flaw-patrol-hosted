"use client";

// The bug form for a bug template (ver_119): title parts, each heading as the template says,
// tables with their automatic cells, file headings, and what's still needed before reporting.

import type { Severity } from "@prisma/client";
import { useState } from "react";
import { acceptOf, fileAllowed, layoutTitle, listWords, missing, PICKER_BUTTONS, type Answer, type BugLayout } from "@/lib/bug-layout";
import type { SeverityScale } from "@/lib/severity";
import type { CurrentLayout } from "@/lib/bug-templates-data";
import type { ImportedDraft } from "@/server/jira";
import { uploadAttachment } from "@/server/results";
import { Sp } from "./spelling";
import { cx, Input, Select, Textarea } from "./ui";

export type TemplateChoice = { id: string; name: string; hint: string; layout: BugLayout };

export type TemplatedDraft = {
  templateId: string;
  layout: BugLayout;
  platform: string;
  area: string;
  build: string;
  summary: string;
  answers: Answer[];
  fields: ImportedDraft["fields"];
};

/** Template buttons, or a dropdown once there are more than five (Scott, ver_119). */
export function TemplatePicker({ current, templates, value, onChange }: { current: CurrentLayout; templates: TemplateChoice[]; value: string; onChange: (id: string) => void }) {
  const all = [{ id: "", name: current.name, hint: "" }, ...templates];
  const hint = all.find((t) => t.id === value)?.hint;
  return (
    <div className="space-y-1" data-testid="template-picker">
      <p className="text-xs font-medium text-slate-600">Template</p>
      {all.length <= PICKER_BUTTONS ? (
        <div role="radiogroup" aria-label="Template" className="flex flex-wrap gap-1.5">
          {all.map((t) => (
            <button
              key={t.id || "current"}
              type="button"
              role="radio"
              aria-checked={value === t.id}
              onClick={() => onChange(t.id)}
              className={cx("rounded-full border px-3 py-1 text-[13px]", value === t.id ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
            >
              {t.name}
            </button>
          ))}
        </div>
      ) : (
        <Select aria-label="Template" value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-72 max-w-full">
          {all.map((t) => (
            <option key={t.id || "current"} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Headings filled from the run that stay folded until "Show everything". */
const FOLDED = new Set(["steps", "expected", "env"]);

export function TemplatedForm({
  projectId,
  draft,
  setDraft,
  severity,
  setSeverity,
  scale,
  setError,
}: {
  projectId: string;
  draft: TemplatedDraft;
  setDraft: (fn: (d: TemplatedDraft) => TemplatedDraft) => void;
  severity: Severity;
  setSeverity: (s: Severity) => void;
  scale: SeverityScale;
  setError: (e: string | null) => void;
}) {
  const [all, setAll] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pasting, setPasting] = useState<Set<string>>(new Set());
  const setAnswer = (id: string, fn: (a: Answer) => Answer) => setDraft((d) => ({ ...d, answers: d.answers.map((a) => (a.id === id ? fn(a) : a)) }));
  const setField = (id: string, value: string[]) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.id === id ? { ...f, value } : f)) }));
  const sectionOf = (id: string) => draft.layout.sections.find((s) => s.id === id);
  const folded = draft.answers.filter((a) => FOLDED.has(a.source));
  const t = draft.layout.title;

  const addFiles = async (a: Answer, list: FileList | null) => {
    const s = sectionOf(a.id);
    if (!list?.length || !s) return;
    setError(null);
    setUploading(a.id);
    for (const file of Array.from(list)) {
      if (!fileAllowed(s.types, file.name)) {
        setError(`${a.heading} takes ${s.types} files, so ${file.name} wasn't added.`);
        continue;
      }
      const form = new FormData();
      form.set("file", file);
      const res = await uploadAttachment(projectId, form);
      if (!res.ok) setError(res.error);
      else setAnswer(a.id, (x) => ({ ...x, files: [...(x.files ?? []), { id: res.attachment.id, fileName: res.attachment.fileName }] }));
    }
    setUploading(null);
  };

  return (
    <div className="space-y-3" data-testid="templated-form">
      <div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
        {t.platform && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="tb-platform">
              Platform
            </label>
            <Input id="tb-platform" value={draft.platform} onChange={(e) => setDraft((d) => ({ ...d, platform: e.target.value }))} placeholder="Optional" />
          </div>
        )}
        {t.area && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="tb-area">
              Area
            </label>
            <Input id="tb-area" value={draft.area} onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))} placeholder="Optional" />
          </div>
        )}
        {t.build && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="tb-build">
              Build
            </label>
            <Input id="tb-build" value={draft.build} onChange={(e) => setDraft((d) => ({ ...d, build: e.target.value }))} placeholder="Optional" />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="tb-summary">
            Summary
          </label>
          <Input id="tb-summary" value={draft.summary} onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))} required placeholder="What's wrong, in a few words" />
        </div>
      </div>
      {(t.platform || t.area || t.build) && (
        <p className="text-[13px] text-slate-600">
          Title: <span className="font-semibold text-slate-900" data-testid="templated-title">{layoutTitle(t, draft)}</span>
        </p>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="tb-severity">
          Severity
        </label>
        <Select id="tb-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className="w-auto min-w-48 max-w-full">
          {scale.levels.map((x) => (
            <option key={x} value={x}>
              {scale.labels[x]}
            </option>
          ))}
        </Select>
      </div>

      {draft.answers.map((a) => {
        const s = sectionOf(a.id);
        if (FOLDED.has(a.source) && !all) return null;
        const need = s?.must ? <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800">Needed</span> : null;
        const label = (
          <span className="mb-1 flex items-center text-xs font-medium text-slate-600">
            {a.heading}
            {need}
          </span>
        );
        if (a.source === "choice")
          return (
            <div key={a.id}>
              {label}
              <div role="radiogroup" aria-label={a.heading} className="flex flex-wrap gap-1.5">
                {(s?.choices ?? []).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={a.text === c}
                    onClick={() => setAnswer(a.id, (x) => ({ ...x, text: x.text === c ? "" : c }))}
                    className={cx("rounded-full border px-2.5 py-0.5 text-[13px]", a.text === c ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700")}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          );
        if (a.source === "table" && a.columns && a.rows)
          return (
            <div key={a.id}>
              {label}
              <div className="overflow-x-auto">
                <table className="min-w-full border border-slate-200 text-xs" aria-label={a.heading}>
                  <thead>
                    <tr>
                      {a.columns.map((c, i) => (
                        <th key={i} className="border-r border-slate-100 bg-slate-100 px-2 py-1 text-left font-semibold whitespace-nowrap text-slate-700">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {a.rows.map((r, ri) => (
                      <tr key={ri}>
                        {a.columns!.map((c, i) => (
                          <td key={i} className={cx("border-t border-r border-slate-100 px-1.5 py-1 align-top", c.fill !== "write" && "bg-slate-50 text-slate-500")}>
                            {c.fill === "write" ? (
                              <input
                                aria-label={c.name}
                                className="w-full min-w-20 rounded border border-slate-300 bg-surface px-1.5 py-0.5"
                                value={r[i] ?? ""}
                                onChange={(e) => setAnswer(a.id, (x) => ({ ...x, rows: x.rows!.map((row, k) => (k === ri ? row.map((cell, j) => (j === i ? e.target.value : cell)) : row)) }))}
                              />
                            ) : c.fill === "files" ? (
                              <span className="whitespace-nowrap">The bug&apos;s files</span>
                            ) : (
                              <span className="whitespace-pre-wrap">{r[i] || "-"}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-slate-500"><Sp>Gray cells fill in automatically. You fill in the white ones. Times include the time zone.</Sp></p>
            </div>
          );
        if (a.source === "file") {
          const pasted = pasting.has(a.id) || !!a.text;
          return (
            <div key={a.id}>
              {label}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-[13px]">
                <label className="cursor-pointer rounded-md border border-slate-300 bg-surface px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  {uploading === a.id ? "Adding…" : "Choose file"}
                  <input type="file" className="sr-only" accept={s ? acceptOf(s.types) || undefined : undefined} multiple aria-label={`Add a file for ${a.heading}`} onChange={(e) => void addFiles(a, e.target.files).then(() => (e.target.value = ""))} />
                </label>
                <span className="text-slate-500">{s?.types.trim() ? `${s.types.split(/[\s,;]+/).filter(Boolean).join(" or ")} files` : "Any file"}</span>
                {(a.files ?? []).map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {f.fileName}
                    <button type="button" aria-label={`Remove ${f.fileName}`} className="text-slate-500 hover:text-slate-800" onClick={() => setAnswer(a.id, (x) => ({ ...x, files: (x.files ?? []).filter((y) => y.id !== f.id) }))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {s?.paste &&
                (pasted ? (
                  <Textarea aria-label={`Paste ${a.heading}`} rows={4} className="mt-1.5 font-mono text-xs" value={a.text} onChange={(e) => setAnswer(a.id, (x) => ({ ...x, text: e.target.value }))} placeholder={`Paste the ${a.heading.toLowerCase()}`} />
                ) : (
                  <button type="button" className="mt-1 text-xs text-accent-700 hover:underline" onClick={() => setPasting((p) => new Set(p).add(a.id))}>
                    Or paste the text instead
                  </button>
                ))}
            </div>
          );
        }
        return (
          <div key={a.id}>
            <label htmlFor={`tb-${a.id}`}>{label}</label>
            <Textarea id={`tb-${a.id}`} rows={a.source === "steps" ? 5 : 3} value={a.text} placeholder={s?.hint || (a.source === "text" ? "Write here" : "")} onChange={(e) => setAnswer(a.id, (x) => ({ ...x, text: e.target.value }))} />
          </div>
        );
      })}
      {folded.length > 0 && (
        <p className="text-xs text-slate-500">
          {all ? "" : `${listWords(folded.map((a) => a.heading))} fill in from the run. `}
          <button type="button" className="text-accent-700 hover:underline" onClick={() => setAll((x) => !x)}>
            {all ? "Hide what fills in from the run" : "Show everything"}
          </button>
        </p>
      )}

      {draft.fields.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold tracking-wider text-slate-700">JIRA FIELDS</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {draft.fields.map((f) => (
              <div key={f.id}>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`tb-f-${f.id}`}>
                  {f.name}
                  {f.required ? " (required)" : ""}
                </label>
                {f.options.length && !f.multi ? (
                  <Select id={`tb-f-${f.id}`} value={f.value[0] ?? ""} onChange={(e) => setField(f.id, [e.target.value].filter(Boolean))}>
                    <option value="">Choose…</option>
                    {f.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </Select>
                ) : (
                  <Input id={`tb-f-${f.id}`} value={f.value.join(", ")} onChange={(e) => setField(f.id, f.multi ? e.target.value.split(/\s*,\s*/) : [e.target.value])} placeholder={f.options.length ? f.options.slice(0, 3).join(", ") : undefined} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** "Add Crash log to report it", next to a dimmed Report button (persona check, ver_119). */
export function missingLine(draft: TemplatedDraft, shots: number) {
  const gaps = missing(draft.layout, draft.answers, shots);
  if (!draft.summary.trim()) gaps.unshift("a summary");
  for (const f of draft.fields) if (f.required && !f.value.some((v) => v.trim())) gaps.push(f.name);
  return gaps.length ? `Add ${listWords(gaps)} to report it` : "";
}

