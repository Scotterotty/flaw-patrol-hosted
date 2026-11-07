"use client";

import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { RUN_FIELD_LABEL, RUN_FIELDS, type ColumnMap, type RunField } from "@/lib/run-import";
import { importIntoRun, importRun, previewRunImport } from "@/server/run-import";
import { readSpreadsheet } from "@/server/spreadsheet";
import { SHEET_HANDOFF, type SheetHandoff } from "@/lib/csv-import";
import { relativeTime } from "@/lib/format";
import { Sp, useZone } from "./spelling";
import { dayIn } from "@/lib/zone";
import { Button, Card, cx, ErrorText, Field, Input, Select } from "./ui";

type Preview = Extract<Awaited<ReturnType<typeof previewRunImport>>, { ok: true }>;

type ActiveRun = { id: string; number: number; name: string; title: string; total: number; tested: number };
const WORD: Record<string, string> = { PASSED: "Passed", FAILED: "Failed", BLOCKED: "Blocked", RETEST: "Retest", SKIPPED: "Skipped" };

/**
 * Test runs → Import a run: read a sheet, check what it means, then add it to a run in
 * progress (ver_166) or create a new run.
 */
export function RunImporter({
  projectId,
  projectKey,
  suites,
  runs = [],
  pickRun,
  handoff = false,
}: {
  projectId: string;
  projectKey: string;
  suites: { id: string; name: string }[];
  runs?: ActiveRun[];
  pickRun?: string;
  /** Opened from the case importer's "Bring them into a run": its sheet is waiting in this tab (ver_169). */
  handoff?: boolean;
}) {
  const router = useRouter();
  // Today on your clock, so an evening upload isn't dated tomorrow.
  const zone = useZone();
  const today = () => dayIn(new Date(), zone);
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
  // Results that differ: the sheet's is used for all of them (ver_177, Scott: "why import if you don't
  // want what the sheet has"), except the ones unticked here.
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [runKind, setRunKind] = useState("");
  const into = target === "run" && runId ? runId : null;
  // How many results that differ will use the sheet's.
  const used = (pv: Preview) => (pv.into ? pv.into.disagree.filter((d) => !keep.has(d.caseId)).length : 0);
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
    setKeep(new Set());
    setRows(data);
  };
  // The sheet the case importer handed over, so nobody picks the same file twice. Used once, within an hour.
  useEffect(() => {
    if (!handoff) return;
    try {
      const saved = sessionStorage.getItem(SHEET_HANDOFF);
      sessionStorage.removeItem(SHEET_HANDOFF);
      const sheet = saved ? (JSON.parse(saved) as Partial<SheetHandoff>) : null;
      if (sheet?.rows?.length && sheet.fileName && Date.now() - (sheet.at ?? 0) < 60 * 60 * 1000) {
        accept(sheet.fileName, sheet.rows);
        // From Create a run: where it goes and the new run's details come along.
        if (sheet.target === "new" || (sheet.target === "run" && runs.length)) setTarget(sheet.target);
        if (sheet.name) setName(sheet.name);
        if (sheet.release) setRelease(sheet.release);
        if (sheet.runKind) setRunKind(sheet.runKind);
      }
    } catch {
      // Nothing handed over: pick the file as usual.
    }
    // Read once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  const load = (f: File) => {
    setError(null);
    if (/\.xlsx$/i.test(f.name)) {
      const form = new FormData();
      form.set("file", f);
      start(async () => {
        const res = await readSpreadsheet(projectId, form);
        if (!res.ok) return setError(res.error);
        // Blank rows are left out here, as before; row 1 is the column names.
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

  if (!rows) {
    return (
      <Card className="p-6">
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <label
          data-howto="run-import-drop"
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
                <input type="radio" name="imp-target" data-howto="import-into-run" checked={target === "run"} onChange={() => setTarget("run")} />
                <span className="font-medium text-slate-800">
                  A run in progress <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">Recommended</span>
                </span>
              </label>
              <span className="grid min-w-0 gap-1.5 pl-5">
                <Select
                  aria-label="Run in progress"
                  data-howto="import-run-pick"
                  value={runId}
                  onChange={(e) => {
                    setRunId(e.target.value);
                    setTarget("run");
                    setKeep(new Set());
                  }}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {r.tested} of {r.total} tested
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-slate-500">Untested cases get the sheet&apos;s result. Results that differ are replaced by the sheet&apos;s, and stay in history.</span>
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
            <Card className="p-4" role="region" aria-label="Updating the run">
              <h2 className="text-sm font-semibold text-slate-800">Updating {runLabel(runs, runId)}</h2>
              <p className="mt-1 text-sm text-slate-700" data-testid="into-summary">
                <strong>{p.into.fill}</strong> {p.into.fill === 1 ? "case gets" : "cases get"} a result
                {p.into.fillInProgress > 0 && ` (${p.into.fillInProgress} in progress)`}
                {p.into.assign > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.assign}</strong> {p.into.assign === 1 ? "gets" : "get"} a tester
                  </>
                )}
                {p.into.disagree.length > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.disagree.length}</strong> {p.into.disagree.length === 1 ? "differs" : "differ"} from the sheet
                  </>
                )}{" "}
                · <strong>{p.into.skipped}</strong> already {p.into.skipped === 1 ? "matches" : "match"}, skipped
                {p.into.automated > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.automated}</strong> automated, left to the automation
                  </>
                )}
                {p.into.blank > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.blank}</strong> {p.into.blank === 1 ? "has" : "have"} no result in the sheet
                  </>
                )}
                {p.into.notInRun.length > 0 && (
                  <>
                    {" "}
                    · <strong>{p.into.notInRun.length}</strong> not in this run, skipped
                  </>
                )}
              </p>
              {p.into.keptTester > 0 && (
                <p className="mt-1 text-xs text-slate-500" data-testid="into-kept-tester">
                  {p.into.keptTester === 1 ? "1 case already has" : `${p.into.keptTester} cases already have`} a different tester here and {p.into.keptTester === 1 ? "keeps them" : "keep them"}.
                </p>
              )}
              {p.into.notInRun.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Not in this run: <span className="font-mono">{p.into.notInRun.slice(0, 12).map((n) => n.key || n.title).join(", ")}{p.into.notInRun.length > 12 && "…"}</span>
                </p>
              )}
              {p.into.disagree.length > 0 && (() => {
                const all = p.into.disagree.every((d) => !keep.has(d.caseId));
                const some = !all && p.into.disagree.some((d) => !keep.has(d.caseId));
                return (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Differs from the sheet">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-amber-950">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        data-howto="import-use-sheet"
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some;
                        }}
                        onChange={() => setKeep(all ? new Set(p.into!.disagree.map((d) => d.caseId)) : new Set())}
                      />
                      <span>
                        <b>Use the sheet&apos;s results</b> for {p.into.disagree.length === 1 ? "the 1 that differs" : `all ${p.into.disagree.length} that differ`}
                        <span className="block text-xs text-amber-900/80">The result here stays in each case&apos;s history.</span>
                      </span>
                    </label>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium text-amber-900 hover:underline">
                        Show the {p.into.disagree.length} that differ
                      </summary>
                      <ul className="mt-1 divide-y divide-amber-200">
                        {p.into.disagree.map((d) => (
                          <li key={d.caseId} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                            <span className="min-w-0">
                              <span className="font-mono text-xs text-slate-500">{d.key}</span> <span className="text-slate-800">{d.title}</span>
                              <span className="block text-xs text-slate-600">
                                Flaw Patrol: <strong>{WORD[d.here] ?? d.here}</strong>
                                {(d.by || d.at) && ` (${[d.by, d.at ? relativeTime(new Date(d.at)) : ""].filter(Boolean).join(", ")})`} · Sheet: <strong>{WORD[d.sheet] ?? d.sheet}</strong>
                              </span>
                            </span>
                            <label className="flex items-center gap-1.5 text-xs text-slate-800">
                              <input
                                type="checkbox"
                                aria-label={`Use the sheet's result for ${d.key}`}
                                checked={!keep.has(d.caseId)}
                                onChange={(e) => {
                                  const next = new Set(keep);
                                  if (e.target.checked) next.delete(d.caseId);
                                  else next.add(d.caseId);
                                  setKeep(next);
                                }}
                              />
                              Use the sheet&apos;s result
                            </label>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                );
              })()}
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <Field label="Tested on" htmlFor="imp-date">
                  <Input id="imp-date" type="date" value={testedOn} max={today()} onChange={(e) => setTestedOn(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={() => setRows(null)}>Cancel</Button>
                  <Button
                    variant="primary"
                    data-howto="import-add"
                    disabled={pending || checking || p.into.fill + used(p) + p.into.assign === 0}
                    onClick={() =>
                      start(async () => {
                        const res = await importIntoRun(projectId, { rows, map, links, fileName }, { runId, testedOn, useSheet: p.into!.disagree.filter((d) => !keep.has(d.caseId)).map((d) => d.caseId) });
                        if (!res.ok) return setError(res.error);
                        router.push(`/p/${projectKey}/runs/${res.number}?updated=${res.filled + res.replaced}${res.assigned ? `&assigned=${res.assigned}` : ""}`);
                      })
                    }
                  >
                    {pending ? "Updating…" : addLabel(p.into.fill + used(p), p.into.assign)}
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
                    const res = await importRun(projectId, { rows, map, links, fileName }, { name, release, testedOn, suiteId: suiteId || null, runKind });
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
  return r ? r.title : "the run";
}

function addLabel(n: number, assign = 0) {
  if (n) return `Update ${n} ${n === 1 ? "result" : "results"}`;
  // Only testers to hand out: say so, instead of "Nothing to update" (Scott, Nov 6).
  return assign ? `Assign ${assign} ${assign === 1 ? "case" : "cases"}` : "Nothing to update";
}
