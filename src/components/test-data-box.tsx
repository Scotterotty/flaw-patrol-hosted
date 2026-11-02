"use client";

import { useState } from "react";
import {
  addPasted,
  MAX_COLUMNS,
  MAX_ROWS,
  parsePasted,
  testDataWarnings,
  toColumnName,
  type TestData,
} from "@/lib/test-data";
import { Button, cx } from "./ui";

// The Test data box under a case's steps. Optional: it stays one dashed line until
// someone clicks + Add test data. Each column is a {{blank}} in the steps; the case runs once per row.

const Blank = ({ name }: { name: string }) => (
  <code className="rounded bg-violet-100 px-1 text-[12px] text-violet-800">{`{{${name}}}`}</code>
);

export function TestDataBox({
  value,
  onChange,
  plainTexts,
  sharedBlanks,
}: {
  value: TestData | null;
  onChange: (next: TestData | null) => void;
  /** Text of each plain step with its number, to check blanks against columns. */
  plainTexts: { step: number; text: string }[];
  /** Blanks in the case's shared steps, which a column can fill. */
  sharedBlanks: string[];
}) {
  const [pasting, setPasting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!value)
    return (
      <section aria-label="Test data" className="mt-4 rounded-lg border border-dashed border-violet-300 bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              // Start with the blanks the steps already have, so the table matches them.
              const found = [...new Set([...plainTexts.flatMap((t) => [...t.text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1])), ...sharedBlanks])];
              const columns = found.length ? found.slice(0, MAX_COLUMNS) : ["role"];
              onChange({ columns, rows: [columns.map(() => ""), columns.map(() => "")] });
            }}
          >
            + Add test data
          </Button>
          <span className="text-xs text-slate-500">(optional)</span>
        </div>
        <p className="mt-2 max-w-prose text-sm text-slate-600">
          Run these steps more than once with different values. For example, write <b>Sign in as <Blank name="role" /></b> in a step, then add a table with a{" "}
          <b>role</b> column listing admin, viewer and guest. The case runs three times, once for each row, and each one gets its own pass or fail.
        </p>
      </section>
    );

  const d = value;
  const filled = d.rows.filter((r) => r.some((v) => v.trim() !== "")).length;
  const { unusedColumns, missing } = testDataWarnings(d, plainTexts, sharedBlanks);
  const set = (next: TestData) => {
    setNote(null);
    onChange(next);
  };
  const setCell = (r: number, c: number, v: string) => set({ ...d, rows: d.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const setColumn = (c: number, typed: string) => set({ ...d, columns: d.columns.map((x, j) => (j === c ? toColumnName(typed) : x)) });
  const removeColumn = (c: number) => set({ columns: d.columns.filter((_, j) => j !== c), rows: d.rows.map((r) => r.filter((_, j) => j !== c)) });
  const addColumn = () => {
    let name = `column${d.columns.length + 1}`;
    while (d.columns.includes(name)) name = `${name}_2`;
    set({ columns: [...d.columns, name], rows: d.rows.map((r) => [...r, ""]) });
  };
  const addRow = () => {
    if (d.rows.length >= MAX_ROWS) return setNote(`Test data holds up to ${MAX_ROWS} rows. Split the rest into another case.`);
    set({ ...d, rows: [...d.rows, d.columns.map(() => "")] });
  };
  const paste = (text: string) => {
    const rows = parsePasted(text);
    if (!rows.length) return;
    const { data, cut } = addPasted(d, rows);
    onChange(data);
    setPasting(false);
    setNote(cut ? `Added what fit. ${cut} ${cut === 1 ? "row was" : "rows were"} left out: test data holds up to ${MAX_ROWS} rows.` : null);
  };
  const dupes = new Set(d.columns.filter((c, i) => c && d.columns.findIndex((x) => x.toLowerCase() === c.toLowerCase()) !== i).map((c) => c.toLowerCase()));

  return (
    <section aria-label="Test data" className="mt-4 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Test data</h2>
        <span className="text-xs text-slate-500" data-testid="test-data-count">
          {filled} of {MAX_ROWS} rows · runs {filled === 1 ? "once" : `${filled} times`}
        </span>
      </div>
      <p className="mt-1 max-w-prose text-sm text-slate-600">
        Type a column name in curly brackets in any step, like {d.columns[0] ? <Blank name={d.columns[0]} /> : <Blank name="role" />}. When the case runs, it runs once for
        each row, with that row&apos;s values filled in.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-8" />
              {d.columns.map((c, j) => (
                <th key={j} className="px-1 pb-1 text-left align-bottom font-normal">
                  <div className="flex items-center gap-1">
                    <input
                      aria-label={`Column ${j + 1} name`}
                      value={c}
                      placeholder="column name"
                      onChange={(e) => setColumn(j, e.target.value)}
                      className={cx(
                        "h-7 w-32 rounded border bg-surface px-1.5 font-mono text-[12px] text-violet-800",
                        !c || dupes.has(c.toLowerCase()) ? "border-red-400" : "border-violet-200",
                      )}
                    />
                    <button type="button" aria-label={`Remove column ${c || j + 1}`} title="Remove this column" onClick={() => removeColumn(j)} className="px-1 text-slate-400 hover:text-red-600">
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {d.rows.map((row, r) => (
              <tr key={r}>
                <td className="pr-1 text-right font-mono text-xs text-slate-400 tabular-nums">{r + 1}</td>
                {row.map((v, j) => (
                  <td key={j} className="p-1">
                    <input
                      aria-label={`Row ${r + 1} ${d.columns[j] || `column ${j + 1}`}`}
                      value={v}
                      onChange={(e) => setCell(r, j, e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!/[\t\n]/.test(text.trim())) return;
                        e.preventDefault();
                        // Several cells pasted into one box: fill from here across and down.
                        const block = parsePasted(text);
                        const rows = d.rows.map((x) => [...x]);
                        block.forEach((line, i) => {
                          if (r + i >= MAX_ROWS) return;
                          if (!rows[r + i]) rows[r + i] = d.columns.map(() => "");
                          line.forEach((val, k) => {
                            if (j + k < d.columns.length) rows[r + i][j + k] = val;
                          });
                        });
                        set({ ...d, rows });
                      }}
                      className="h-8 w-32 rounded border border-slate-200 bg-surface px-1.5"
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    aria-label={`Remove row ${r + 1}`}
                    title="Remove this row"
                    onClick={() => set({ ...d, rows: d.rows.filter((_, i) => i !== r) })}
                    className="px-1 text-slate-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={addRow}>
          + Add row
        </Button>
        <Button size="sm" onClick={addColumn} disabled={d.columns.length >= MAX_COLUMNS}>
          + Add column
        </Button>
        <Button size="sm" onClick={() => setPasting((p) => !p)} aria-expanded={pasting}>
          Paste rows from a sheet
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Remove test data
        </Button>
      </div>
      {pasting && (
        <div className="mt-2 grid gap-1">
          <label htmlFor="test-data-paste" className="text-xs text-slate-600">
            Copy rows in Google Sheets or Excel, then paste them here.{" "}
            {filled === 0 ? "The first row becomes the column names." : "They're added under the rows you have."}
          </label>
          <textarea
            id="test-data-paste"
            rows={3}
            autoFocus
            placeholder="Paste here"
            onPaste={(e) => {
              e.preventDefault();
              paste(e.clipboardData.getData("text"));
            }}
            onChange={(e) => {
              if (e.target.value.includes("\n")) paste(e.target.value);
            }}
            className="rounded border border-slate-300 bg-surface p-2 font-mono text-xs"
          />
        </div>
      )}
      {(note || unusedColumns.length > 0 || missing.length > 0) && (
        <div className="mt-2 grid gap-1">
          {note && <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">{note}</p>}
          {unusedColumns.map((c) => (
            <p key={c} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="test-data-unused">
              The column <b>{c}</b> isn&apos;t in any step yet. Type <Blank name={c} /> in a step to use it.
            </p>
          ))}
          {missing.map((m) => (
            <p key={m.name} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="test-data-missing">
              <Blank name={m.name} /> in step {m.step} has no column. Add a column named <b>{m.name}</b>, or change the step.
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
