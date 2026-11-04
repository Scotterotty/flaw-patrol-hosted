"use client";

import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { RUN_FIELD_LABEL, RUN_FIELDS, type ColumnMap, type RunField } from "@/lib/run-import";
import { importIntoRun, importRun, previewRunImport } from "@/server/run-import";
import { readSpreadsheet } from "@/server/spreadsheet";
import { Sp } from "./spelling";
import { Button, Card, cx, ErrorText, Field, Input, Select } from "./ui";

type Preview = Extract<Awaited<ReturnType<typeof previewRunImport>>, { ok: true }>;
const today = () => new Date().toISOString().slice(0, 10);

type ActiveRun = { id: string; number: number; name: string; total: number; tested: number };
const WORD: Record<string, string> = { PASSED: "Passed", FAILED: "Failed", BLOCKED: "Blocked", RETEST: "Retest", SKIPPED: "Skipped" };

/**
 * Test runs → Import a run: read a sheet, check what it means, then add it to a run in
 * progress (ver_166) or create a new run.
 */
export function RunImporter({ projectId, projectKey, suites, runs = [], pickRun }: { projectId: string; projectKey: string; suites: { id: string; name: string }[]; runs?: ActiveRun[]; pickRun?: string }) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [release, setRelease] = useState("");
  const [testedOn, setTestedOn] = useState(today());
  const [suiteId, setSuiteId] = useState("");
  // Where should the results go: a run in progress (Recommended) when there is one.
  const [target, setTarget] = useState<"run" | "new">(runs.length ? "run" : "new");
  const [runId, setRunId] = useState(runs.find((r) => r.id === pickRun || String(r.number) === pickRun)?.id ?? runs[0]?.id ?? "");
  const [useSheet, setUseSheet] = useState<Set<string>>(new Set());
  const into = target === "run" && runId ? runId : null;
  const [pending, start] = useTransition();
  const [checking, startCheck] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  // Re-check whenever the columns or tester links change.
  useEffect(() => {
    if (!rows) return;
    startCheck(async () => {
      const res = await previewRunImport(projectId, { rows, map, links, fileName }, into);
      if (!res.ok) {
        setPreview(null);
        return setError(res.error);
      }
      setError(null);
      setPreview(res);
      if (!map) setMap(res.map);
    });
  }, [projectId, rows, map, links, fileName, into]);

  const accept = (n: string, data: string[][]) => {
    if (data.length < 2) return setError("That file has no rows under the header.");
    data[0][0] = (data[0][0] ?? "").replace(/^﻿/, "");
    setFileName(n);
    setName(n.replace(/\.(csv|tsv|txt|xlsx)$/i, ""));
    setMap(null);
    setLinks({});
    setUseSheet(new Set());
    setRows(data);
  };
  const load = (f: File) => {
    setError(null);
    if (/\.xlsx$/i.test(f.name)) {
      const form = new FormData();
      form.set("file", f);
      start(async () => {
        const res = await readSpreadsheet(projectId, form);
        if (!res.ok) return setError(res.error);
        accept(f.name, res.rows);
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

  if (!rows) {
    return (
      <Card className="p-6">
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <label
          className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center hover:bg-slate-50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) load(f);
          }}
        >
          <span className="font-medium text-slate-800">Drop your sheet here, or choose a file</span>
          <span className="text-sm text-slate-500">CSV from Google Sheets (File → Download → .csv) or .xlsx. One row per step, one tab per run.</span>
          <input ref={file} type="file" accept=".csv,.tsv,.txt,.xlsx" className="sr-only" aria-label="Sheet file" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
      </Card>
    );
  }

  const header = rows[0];
  const p = preview;
  const final = p ? p.counts.PASSED + p.counts.FAILED + p.counts.BLOCKED + p.counts.RETEST + p.counts.SKIPPED : 0;
  return (
    <div className="space-y-4">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Columns in <span className="font-mono">{fileName}</span>
          </h2>
          <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setRows(null)}>
            Choose another file
          </button>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">Matched automatically. Change any that are wrong.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {RUN_FIELDS.map((f: RunField) => (
            <Field key={f} label={RUN_FIELD_LABEL[f]} htmlFor={`col-${f}`}>
              <Select
                id={`col-${f}`}
                value={map?.[f] ?? ""}
                onChange={(e) => {
                  const next = { ...(map ?? {}) };
                  if (e.target.value === "") delete next[f];
                  else next[f] = Number(e.target.value);
                  setMap(next);
                }}
              >
                <option value="">(none)</option>
                {header.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Column ${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
      </Card>

      {runs.length > 0 && (
        <Card className="p-4" role="radiogroup" aria-label="Where should the results go?">
          <h2 className="text-sm font-semibold text-slate-800">Where should the results go?</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className={cx("grid gap-1.5 rounded-md border p-3 text-sm", target === "run" ? "border-accent-500 bg-accent-50" : "border-slate-200")}>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="radio" name="imp-target" checked={target === "run"} onChange={() => setTarget("run")} />
                <span className="font-medium text-slate-800">
                  A run in progress <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Recommended</span>
                </span>
              </label>
              <span className="grid min-w-0 gap-1.5 pl-5">
                <Select
                  aria-label="Run in progress"
                  value={runId}
                  onChange={(e) => {
                    setRunId(e.target.value);
                    setTarget("run");
                    setUseSheet(new Set());
                  }}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      R{r.number} {r.name} · {r.tested} of {r.total} tested
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">Only cases still untested get the sheet&apos;s result. Anything already marked here stays as it is.</span>
              </span>
            </div>
            <label className={cx("flex cursor-pointer gap-2 rounded-md border p-3 text-sm", target === "new" ? "border-accent-500 bg-accent-50" : "border-slate-200")}>
              <input type="radio" name="imp-target" className="mt-0.5" checked={target === "new"} onChange={() => setTarget("new")} />
              <span className="grid gap-0.5">
                <span className="font-medium text-slate-800">A new run</span>
                <span className="text-xs text-slate-500">Make a run from the sheet. It stays open so you can finish it here.</span>
              </span>
            </label>
          </div>
        </Card>
      )}

      {p && (
        <>
          <section aria-label="What Flaw Patrol found" className="grid gap-3 sm:grid-cols-5">
            <Tile label="Cases matched" value={p.matched} tone="good" />
            <Tile label="Not found" value={p.notFound.length} tone={p.notFound.length ? "warn" : undefined} />
            <Tile label="Step results" value={p.stepResults} />
            <Tile label="Cases with a result" value={final} sub={`${p.counts.IN_PROGRESS} in progress · ${p.counts.UNTESTED} not started`} />
            <Tile label="Jira bugs" value={p.bugs} />
          </section>

          <Card className="overflow-x-auto" role="region" aria-label="Testers">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Testers</h2>
            {p.testers.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">The sheet doesn&apos;t name any testers.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name in the sheet</th>
                    <th className="px-4 py-2 font-medium">Cases</th>
                    <th className="px-4 py-2 font-medium">Flaw Patrol user</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {p.testers.map((t) => (
                    <tr key={t.name}>
                      <td className="px-4 py-2 font-medium text-slate-800">{t.name}</td>
                      <td className="px-4 py-2 tabular-nums">{t.cases}</td>
                      <td className="px-4 py-2">
                        <Select className="w-auto" aria-label={`Flaw Patrol user for ${t.name}`} value={t.memberId} onChange={(e) => setLinks({ ...links, [t.name]: e.target.value })}>
                          <option value="">Keep as text</option>
                          {p.members.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </Select>
                        {t.auto && t.memberId && <span className="ml-2 text-xs text-slate-500">matched automatically</span>}
                        {!t.memberId && <span className="ml-2 text-xs text-amber-700">not linked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Linked testers get the cases assigned to them. Links you pick here are remembered for this test cycle&apos;s next import.</p>
          </Card>

          {(p.notFound.length > 0 || p.duplicates.length > 0 || p.stepMismatches.length > 0 || p.unknownWords.length > 0) && (
            <Card className="p-4" role="region" aria-label="Needs a look">
              <h2 className="text-sm font-semibold text-slate-800">Needs a look</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {p.notFound.length > 0 && (
                  <li>
                    <span className="text-amber-800">
                      {p.notFound.length} {p.notFound.length === 1 ? "case isn't" : "cases aren't"} in the case library:{" "}
                    </span>
                    <span className="font-mono text-xs">{p.notFound.slice(0, 12).map((n) => n.key || n.title).join(", ")}{p.notFound.length > 12 && "…"}</span>
                    <span className="text-slate-500"> · skipped. Import those cases first to include them.</span>
                  </li>
                )}
                {p.duplicates.length > 0 && (
                  <li>
                    <span className="text-amber-800">In the sheet twice: </span>
                    <span className="font-mono text-xs">{p.duplicates.join(", ")}</span>
                    <span className="text-slate-500"> · only the first is used.</span>
                  </li>
                )}
                {p.stepMismatches.slice(0, 8).map((m) => (
                  <li key={m.key}>
                    <span className="text-amber-800">
                      {m.sheetKey || m.key} has {m.sheet} {m.sheet === 1 ? "step" : "steps"} in the sheet, {m.steps} in Flaw Patrol
                    </span>
                    <span className="text-slate-500"> · {m.sheet < m.steps ? "the rest stay Untested" : "extra rows are ignored"}.</span>
                  </li>
                ))}
                {p.stepMismatches.length > 8 && <li className="text-slate-500">…and {p.stepMismatches.length - 8} more cases with a different number of steps.</li>}
                {p.unknownWords.length > 0 && (
                  <li>
                    <span className="text-amber-800">
                      <Sp>{"Results Flaw Patrol doesn't recognize: "}</Sp>
                    </span>
                    {p.unknownWords.map((w) => `"${w}"`).join(", ")}
                    <span className="text-slate-500"> · read as Untested.</span>
                  </li>
                )}
              </ul>
            </Card>
          )}

          {target === "run" && p.into && (
            <Card className="p-4" role="region" aria-label="Adding to the run">
              <h2 className="text-sm font-semibold text-slate-800">Adding to {runLabel(runs, runId)}</h2>
              <p className="mt-1 text-sm text-slate-700" data-testid="into-summary">
                <strong>{p.into.fill}</strong> {p.into.fill === 1 ? "case gets" : "cases get"} a result
                {p.into.fillInProgress > 0 && ` (${p.into.fillInProgress} in progress)`} · <strong>{p.into.skipped + p.into.disagree.length}</strong> already done here, skipped
                {p.into.blank > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.blank}</strong> blank in the sheet, left as they are
                  </>
                )}
                {p.into.notInRun.length > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.notInRun.length}</strong> not in this run, skipped
                  </>
                )}
              </p>
              {p.into.notInRun.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Not in this run: <span className="font-mono">{p.into.notInRun.slice(0, 12).map((n) => n.key || n.title).join(", ")}{p.into.notInRun.length > 12 && "…"}</span>
                </p>
              )}
              {p.into.disagree.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Disagrees with the sheet">
                  <p className="text-sm font-semibold text-amber-900">
                    {p.into.disagree.length} {p.into.disagree.length === 1 ? "case disagrees" : "cases disagree"} with the sheet
                  </p>
                  <p className="text-xs text-amber-900/80">Nothing changes unless you tick it. If you do, the result here stays in the case&apos;s history.</p>
                  <ul className="mt-2 divide-y divide-amber-200">
                    {p.into.disagree.map((d) => (
                      <li key={d.caseId} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="min-w-0">
                          <span className="font-mono text-xs text-slate-500">{d.key}</span> <span className="text-slate-800">{d.title}</span>
                          <span className="block text-xs text-slate-600">
                            Flaw Patrol: <strong>{WORD[d.here] ?? d.here}</strong> · Sheet: <strong>{WORD[d.sheet] ?? d.sheet}</strong>
                          </span>
                        </span>
                        <label className="flex items-center gap-1.5 text-xs text-slate-800">
                          <input
                            type="checkbox"
                            aria-label={`Use the sheet's result for ${d.key}`}
                            checked={useSheet.has(d.caseId)}
                            onChange={(e) => {
                              const next = new Set(useSheet);
                              if (e.target.checked) next.add(d.caseId);
                              else next.delete(d.caseId);
                              setUseSheet(next);
                            }}
                          />
                          Use the sheet&apos;s result
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <Field label="Tested on" htmlFor="imp-date">
                  <Input id="imp-date" type="date" value={testedOn} max={today()} onChange={(e) => setTestedOn(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={() => setRows(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    disabled={pending || checking || p.into.fill + useSheet.size === 0}
                    onClick={() =>
                      start(async () => {
                        const res = await importIntoRun(projectId, { rows, map, links, fileName }, { runId, testedOn, useSheet: [...useSheet] });
                        if (!res.ok) return setError(res.error);
                        router.push(`/p/${projectKey}/runs/${res.number}`);
                      })
                    }
                  >
                    {pending ? "Adding…" : addLabel(p.into.fill + p.into.disagree.filter((d) => useSheet.has(d.caseId)).length)}
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">A blank or &quot;Select&quot; in the sheet never clears a result.</p>
            </Card>
          )}

          {target === "new" && (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-800">The new run</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Run name" htmlFor="imp-name">
                <Input id="imp-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Release" htmlFor="imp-rc">
                <Input id="imp-rc" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="e.g. 2.1 or RC 22" />
              </Field>
              <Field label="Tested on" htmlFor="imp-date">
                <Input id="imp-date" type="date" value={testedOn} max={today()} onChange={(e) => setTestedOn(e.target.value)} />
              </Field>
              <Field label="Suite (optional)" htmlFor="imp-suite">
                {suites.length ? (
                  <Select id="imp-suite" value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                    <option value="">None</option>
                    {suites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  // No suites yet: a plain line instead of a list with only None.
                  <p id="imp-suite" className="flex h-9 items-center text-sm text-slate-500" data-testid="no-suites-optional">
                    No suites yet. That&apos;s fine, it&apos;s optional.
                  </p>
                )}
              </Field>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The run stays open. Cases the sheet hadn&apos;t reached are Untested, and part-done cases are In progress, so they can be finished here. Results count from the date you pick.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setRows(null)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={pending || checking || !p.matched || !name.trim()}
                onClick={() =>
                  start(async () => {
                    const res = await importRun(projectId, { rows, map, links, fileName }, { name, release, testedOn, suiteId: suiteId || null });
                    if (!res.ok) return setError(res.error);
                    router.push(`/p/${projectKey}/runs/${res.number}`);
                  })
                }
              >
                {pending ? "Creating…" : `Create run with ${p.matched} ${p.matched === 1 ? "case" : "cases"}`}
              </Button>
            </div>
          </Card>
          )}
        </>
      )}
      {!p && checking && <p className="text-sm text-slate-500">Reading the sheet…</p>}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "good" | "warn" }) {
  return (
    <Card className="p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={cx("mt-0.5 text-xl font-semibold tabular-nums", tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-slate-900")}>{value.toLocaleString()}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </Card>
  );
}

function runLabel(runs: ActiveRun[], id: string) {
  const r = runs.find((x) => x.id === id);
  return r ? `R${r.number} ${r.name}` : "the run";
}

function addLabel(n: number) {
  return n ? `Add ${n} ${n === 1 ? "result" : "results"} to the run` : "Nothing to add";
}
