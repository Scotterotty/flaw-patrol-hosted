"use client";

import Papa from "papaparse";
import { useState, useTransition } from "react";
import { SHEET_HANDOFF, type SheetHandoff } from "@/lib/csv-import";
import { readSpreadsheet } from "@/server/spreadsheet";
import type { RunBoxOptions } from "@/server/start-run";
import { cx, ErrorText, Select } from "./ui";

/** Create a run → From a spreadsheet (ver_177): the sheet picked in the box. */
export type PickedSheet = { fileName: string; rows: string[][] };
type SheetCycle = RunBoxOptions["sheetCycles"][number];
/** Where it goes: a run in progress (cycle id + run number), or a new run in a test cycle. */
export type SheetTarget = { cycleId: string; run: number | null };

/** The first run in progress (in the test cycle the box was opened from, when it has one), else a new run. */
export function firstSheetTarget(cycles: SheetCycle[], hereId: string | null): SheetTarget | null {
  const here = cycles.find((c) => c.id === hereId);
  const withRun = here?.runs.length ? here : cycles.find((c) => c.runs.length);
  if (withRun) return { cycleId: withRun.id, run: withRun.runs[0].number };
  const first = here ?? cycles[0];
  return first ? { cycleId: first.id, run: null } : null;
}

/** Pick the .csv or .xlsx right in the box. */
export function SheetPick({ projectId, sheet, onSheet }: { projectId: string; sheet: PickedSheet | null; onSheet: (s: PickedSheet | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [reading, start] = useTransition();
  const accept = (fileName: string, data: string[][]) => {
    if (data.length < 2) return setError("That file has no rows under the header.");
    data[0][0] = (data[0][0] ?? "").replace(/^﻿/, "");
    setError(null);
    onSheet({ fileName, rows: data });
  };
  const load = (f: File) => {
    setError(null);
    if (/\.xlsx$/i.test(f.name)) {
      const form = new FormData();
      form.set("file", f);
      start(async () => {
        const res = await readSpreadsheet(projectId, form);
        if (!res.ok) return setError(res.error);
        accept(f.name, res.rows.filter((r) => r.some((c) => c.trim())));
      });
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) return setError("Choose a .csv or .xlsx file. In Google Sheets: File → Download → Comma-separated values.");
    Papa.parse<string[]>(f, {
      skipEmptyLines: "greedy",
      complete: (res) => accept(f.name, res.data.map((r) => r.map((c) => String(c ?? "")))),
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  };
  return (
    <div className="space-y-1.5" data-testid="sheet-pick">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {sheet ? (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="sheet-picked">
          <span className="min-w-0 flex-1">
            📄 <b className="font-mono">{sheet.fileName}</b> · {sheet.rows.length - 1} {sheet.rows.length === 2 ? "row" : "rows"}
            <span className="block text-xs text-emerald-800">Its cases and results come in. Blank results stay to test.</span>
          </span>
          <button type="button" className="text-xs font-medium text-emerald-800 underline" onClick={() => onSheet(null)}>
            Change
          </button>
        </p>
      ) : (
        <label
          data-howto="run-sheet-file"
          className="flex cursor-pointer flex-col items-center gap-0.5 rounded-md border-2 border-dashed border-slate-300 px-4 py-5 text-center hover:bg-slate-50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
        >
          <span className="text-sm font-medium text-slate-800">{reading ? "Reading the sheet…" : "Drop your sheet here, or choose a file"}</span>
          <span className="text-xs text-slate-500">.csv or .xlsx. One row per step or per case, with a result column.</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr-only" aria-label="Spreadsheet file" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}

/** Step 2 for a sheet: update a run in progress, or make a new run in one test cycle. */
export function SheetWhere({ cycles, value, onChange }: { cycles: SheetCycle[]; value: SheetTarget | null; onChange: (t: SheetTarget) => void }) {
  const runs = cycles.flatMap((c) => c.runs.map((r) => ({ ...r, cycle: c })));
  const updating = !!value && value.run !== null;
  const many = cycles.length > 1;
  const newCycle = (!updating && value?.cycleId) || cycles[0]?.id || "";
  const runValue = updating ? `${value!.cycleId}:${value!.run}` : runs[0] ? `${runs[0].cycle.id}:${runs[0].number}` : "";
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where the sheet goes" data-howto="run-sheet-where">
      {runs.length > 0 && (
        <div className={cx("grid gap-1.5 rounded-md border p-3 text-sm", updating ? "border-accent-500 bg-accent-50" : "border-slate-200")}>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="rb-sheet-target"
              checked={updating}
              onChange={() => {
                const [cycleId, n] = runValue.split(":");
                onChange({ cycleId, run: Number(n) });
              }}
            />
            <span className="font-medium text-slate-800">Update a run in progress</span>
          </label>
          <Select
            className="ml-5 w-auto min-w-0"
            aria-label="Run in progress to update"
            value={runValue}
            onChange={(e) => {
              const [cycleId, n] = e.target.value.split(":");
              onChange({ cycleId, run: Number(n) });
            }}
          >
            {runs.map((r) => (
              <option key={`${r.cycle.id}:${r.number}`} value={`${r.cycle.id}:${r.number}`}>
                {r.title} · {r.tested} of {r.total} tested{many ? ` · ${r.cycle.name}` : ""}
              </option>
            ))}
          </Select>
          <span className="pl-5 text-xs text-slate-500">The sheet fills untested cases and replaces results that differ. Old results stay in history.</span>
        </div>
      )}
      <div className={cx("grid gap-1.5 rounded-md border p-3 text-sm", !updating && value ? "border-accent-500 bg-accent-50" : "border-slate-200")}>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" name="rb-sheet-target" checked={!updating && !!value} onChange={() => onChange({ cycleId: newCycle, run: null })} />
          <span className="font-medium text-slate-800">A new run</span>
        </label>
        {many ? (
          <Select className="ml-5 w-auto min-w-0" aria-label="Test cycle for the new run" value={newCycle} onChange={(e) => onChange({ cycleId: e.target.value, run: null })}>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                in {c.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="pl-5 text-xs text-slate-600">in {cycles[0]?.name}</span>
        )}
        <span className="pl-5 text-xs text-slate-500">Make a run from the sheet. It stays open so you can finish it here.</span>
      </div>
    </div>
  );
}

/** Hand the sheet to the test cycle's check page (the import page reads it once, within an hour). */
export function handOffSheet(cycle: { key: string }, sheet: PickedSheet, target: SheetTarget, extra: Omit<SheetHandoff, "fileName" | "rows" | "at" | "target">) {
  const data: SheetHandoff = { fileName: sheet.fileName, rows: sheet.rows, at: Date.now(), target: target.run === null ? "new" : "run", ...extra };
  try {
    sessionStorage.setItem(SHEET_HANDOFF, JSON.stringify(data));
  } catch {
    // Storage full or blocked: the check page asks for the file again.
  }
  window.location.assign(`/p/${cycle.key}/runs/import?sheet=handoff${target.run !== null ? `&run=${target.run}` : ""}`);
}
