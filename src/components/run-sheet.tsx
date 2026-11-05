"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ROLE_LABEL, type FillRole } from "@/lib/sheet-fill";
import { type FillPreview, getSheetScript, linkRunSheet, previewRunSheet, setRunSheetAuto, syncRunSheet, unlinkRunSheet } from "@/server/run-sheet";
import { Modal } from "./modal";
import { Button, ErrorText, Field, Input, Select } from "./ui";

export type SheetState = {
  hook: string | null;
  tab: string;
  auto: boolean;
  link: string;
  syncedAgo: string | null;
  error: string;
  mode: "tab" | "fill";
  /** For Fill in my columns: what it fills, in words, and what the last send did. */
  fills: string;
  note: string;
};

type Mode = "tab" | "fill";

/** "Google Sheet" in a run's More menu: link a sheet, then send the run's results to it on demand or as they're saved. */
export function RunSheetButton({ projectId, runId, runName, sheet }: { projectId: string; runId: string; runName: string; sheet: SheetState }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept in state so a failed attempt doesn't clear what was pasted.
  const [hook, setHook] = useState(sheet.hook ?? "");
  const [mode, setMode] = useState<Mode>(sheet.hook ? sheet.mode : "fill");
  const [tab, setTab] = useState(sheet.tab);
  const [auto, setAuto] = useState(sheet.auto);
  const [preview, setPreview] = useState<FillPreview | null>(null);
  const [headerRow, setHeaderRow] = useState("");
  const [set, setSet] = useState(0);
  const [off, setOff] = useState<FillRole[]>([]);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const linked = !!sheet.hook && !editing;

  const show = () => {
    setOpen(true);
    setError(null);
    setEditing(false);
    if (!sheet.hook) loadScript();
  };
  const loadScript = () => {
    if (script) return;
    void getSheetScript(projectId).then((r) => (r.ok ? setScript(r.script) : setError(r.error)));
  };
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      router.refresh();
      if (!r.ok) return setError(r.error);
      setError(null);
      after?.();
    });
  const look = () =>
    start(async () => {
      const r = await previewRunSheet(projectId, runId, { hook, tab, headerRow: Number(headerRow) || null });
      if (!r.ok) {
        setPreview(null);
        return setError(r.error);
      }
      setError(null);
      setPreview(r);
      setHeaderRow(String(r.headerRow));
      setSet((n) => (n < r.sets.length ? n : 0));
      setPicks({});
    });
  // A new sheet or tab needs a fresh look before linking.
  const changed = (fn: () => void) => {
    fn();
    setPreview(null);
  };

  const chosen = preview?.sets[set];
  const roles = chosen ? chosen.cols.map((c) => c.role).filter((r) => !off.includes(r)) : [];
  const placed = preview ? preview.matched + preview.unmatched.filter((u) => picks[u.id] > 0).length : 0;
  const link = () =>
    act(
      () =>
        linkRunSheet(projectId, runId, {
          hook,
          tab,
          auto,
          mode,
          ...(mode === "fill" && preview && chosen ? { fill: { headerRow: preview.headerRow, set, roles, rows: picks, label: chosen.label } } : {}),
        }),
      () => setOpen(false),
    );

  return (
    <>
      <Button variant="ghost" onClick={show} data-howto="run-google-sheet">
        Send to a Google Sheet
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send results to a Google Sheet" wide>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {linked ? (
          <div className="space-y-3 text-sm">
            {sheet.mode === "fill" ? (
              <p className="text-slate-700">
                Fills {sheet.fills} in the <strong>{sheet.tab}</strong> tab{sheet.syncedAgo ? `, last sent ${sheet.syncedAgo}` : ""}. Cells someone typed in are never changed.
                {sheet.note && <span className="block text-slate-500">Last send: {sheet.note}.</span>}
              </p>
            ) : (
              <p className="text-slate-700">
                Linked to the <strong>{sheet.tab}</strong> tab{sheet.syncedAgo ? `, last sent ${sheet.syncedAgo}` : ""}. Sending replaces the tab&apos;s words with the run&apos;s current
                results.
              </p>
            )}
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={auto}
                disabled={pending}
                onChange={(e) => {
                  const on = e.target.checked;
                  setAuto(on);
                  act(async () => {
                    const r = await setRunSheetAuto(projectId, runId, on);
                    if (!r.ok) setAuto(!on);
                    return r;
                  });
                }}
              />
              Send automatically each time a result is saved
            </label>
            {sheet.link && (
              <p>
                <a href={sheet.link} target="_blank" rel="noreferrer" className="text-accent-700 underline">
                  Open the sheet
                </a>
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="danger" disabled={pending} onClick={() => act(() => unlinkRunSheet(projectId, runId), () => setOpen(false))}>
                Stop sending
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setEditing(true);
                  setPreview(null);
                  loadScript();
                }}
              >
                Change
              </Button>
              <Button variant="primary" disabled={pending} onClick={() => act(() => syncRunSheet(projectId, runId))}>
                {pending ? "Sending…" : "Send to sheet"}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "fill" && !preview) look();
              else link();
            }}
          >
            <ol className="list-decimal space-y-3 pl-5 text-slate-700">
              <li>
                In the Google Sheet, open <strong>Extensions › Apps Script</strong>. Replace what&apos;s there with this script and save.
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    disabled={!script}
                    data-howto="sheet-copy-script"
                    onClick={() =>
                      script &&
                      void navigator.clipboard?.writeText(script).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    {copied ? "Copied" : "Copy script"}
                  </Button>
                  <span className="text-xs text-slate-500">It only accepts results from this test cycle. Sent results to this sheet before? Paste the script again, it&apos;s new.</span>
                </div>
                {script && (
                  <textarea readOnly aria-label="Script" value={script} rows={4} className="mt-2 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600" />
                )}
              </li>
              <li>
                Click <strong>Deploy › New deployment</strong>, pick <strong>Web app</strong>, set <strong>Who has access</strong> to <strong>Anyone</strong>, and deploy. Allow the access Google asks for.
              </li>
              <li>Paste the Web app URL it gives you here.</li>
            </ol>
            <Field label="Web app URL" htmlFor="sheet-hook">
              <Input id="sheet-hook" data-howto="sheet-url" required value={hook} onChange={(e) => changed(() => setHook(e.target.value))} placeholder="https://script.google.com/macros/s/…/exec" />
            </Field>
            <fieldset className="space-y-2" data-howto="sheet-how">
              <legend className="mb-1 text-xs font-medium text-slate-600">How to send</legend>
              {(
                [
                  ["fill", "Fill in my columns", "For a sheet you already use. Only the columns you pick change, and cells someone typed in stay."],
                  ["tab", "A tab of its own", "Flaw Patrol writes the whole tab in your cycle sheet's look."],
                ] as const
              ).map(([value, name, help]) => (
                <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${mode === value ? "border-accent-500 bg-accent-50" : "border-slate-200"}`}>
                  <input type="radio" name="sheet-mode" className="mt-1" checked={mode === value} onChange={() =>
                      changed(() => {
                        setMode(value);
                        if (value === "tab" && !tab) setTab(runName.slice(0, 100));
                      })
                    } />
                  <span>
                    <span className="block font-medium text-slate-800">{name}</span>
                    <span className="block text-xs text-slate-500">{help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field
              label="Tab"
              htmlFor="sheet-tab"
              hint={
                mode === "fill"
                  ? "The tab's name at the bottom of the sheet, exactly as written."
                  : "Made if it doesn't exist. Each send rewrites the tab in your cycle sheet's look; column widths and hidden columns you set stay."
              }
            >
              <Input
                id="sheet-tab"
                required
                value={tab}
                onChange={(e) => changed(() => setTab(e.target.value))}
                placeholder={mode === "fill" ? "Web" : undefined}
              />
            </Field>
            {mode === "fill" && preview && chosen && (
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3" aria-label="What Flaw Patrol found">
                <p className="text-slate-800">
                  <strong>
                    Found your header on row {preview.headerRow}. Matched {placed} of {preview.total} {preview.total === 1 ? "case" : "cases"}.
                  </strong>{" "}
                  <span className="text-slate-500">Rows in the sheet that aren&apos;t in this run stay as they are.</span>
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Header row" htmlFor="sheet-header">
                    <Input id="sheet-header" type="number" min={1} max={500} className="w-24" value={headerRow} onChange={(e) => setHeaderRow(e.target.value)} />
                  </Field>
                  {String(preview.headerRow) !== headerRow && (
                    <Button type="button" disabled={pending} onClick={look}>
                      Look again
                    </Button>
                  )}
                  {preview.sets.length > 1 && (
                    <Field label="Fill" htmlFor="sheet-set">
                      <Select id="sheet-set" className="w-auto max-w-full" value={set} onChange={(e) => setSet(Number(e.target.value))}>
                        {preview.sets.map((s, i) => (
                          <option key={s.label} value={i}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {chosen.cols.map((c) => (
                    <label key={c.role} className="flex items-center gap-2 text-slate-700">
                      <input type="checkbox" checked={!off.includes(c.role)} onChange={(e) => setOff((o) => (e.target.checked ? o.filter((r) => r !== c.role) : [...o, c.role]))} />
                      Fill {c.header || ROLE_LABEL[c.role]} <span className="text-xs text-slate-500">(column {c.letter})</span>
                    </label>
                  ))}
                </div>
                {preview.unmatched.length > 0 && (
                  <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5">
                    <p className="font-medium text-amber-900">
                      {preview.unmatched.length === 1 ? "1 case isn't in the sheet yet." : `${preview.unmatched.length} cases aren't in the sheet yet.`}{" "}
                      <span className="font-normal">Pick their rows, or leave them and they&apos;re skipped.</span>
                    </p>
                    {preview.unmatched.map((u) => (
                      <div key={u.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-slate-700" title={u.title}>
                          {u.title}
                        </span>
                        <Select
                          aria-label={`Row for ${u.title}`}
                          className="h-8 w-auto max-w-full text-sm"
                          value={picks[u.id] ?? ""}
                          onChange={(e) => setPicks((p) => ({ ...p, [u.id]: Number(e.target.value) }))}
                        >
                          <option value="">Pick its row…</option>
                          <option value="0">Skip this case</option>
                          {preview.free
                            .filter((f) => f.row === picks[u.id] || !Object.values(picks).includes(f.row))
                            .map((f) => (
                              <option key={f.row} value={f.row}>
                                Row {f.row}: {f.text.slice(0, 60)}
                              </option>
                            ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-slate-700">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Send automatically each time a result is saved
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => (sheet.hook ? setEditing(false) : setOpen(false))}>
                Cancel
              </Button>
              {mode === "fill" && !preview ? (
                <Button type="submit" variant="primary" disabled={pending} data-howto="sheet-send">
                  {pending ? "Looking…" : "Look at the sheet"}
                </Button>
              ) : (
                <Button type="submit" variant="primary" disabled={pending || (mode === "fill" && !roles.length)} data-howto="sheet-send">
                  {pending ? "Sending…" : "Link and send"}
                </Button>
              )}
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** One line on the run page while a sheet is linked, so a broken link doesn't go unnoticed. */
export function RunSheetStatus({ projectId, runId, sheet }: { projectId: string; runId: string; sheet: SheetState }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (!sheet.hook) return null;
  const problem = error ?? sheet.error;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-500" aria-label="Google Sheet">
      <span>
        {sheet.auto ? "Results go to the" : "Linked to the"}{" "}
        {sheet.link ? (
          <a href={sheet.link} target="_blank" rel="noreferrer" className="text-accent-700 underline">
            {sheet.tab}
          </a>
        ) : (
          sheet.tab
        )}{" "}
        tab of a Google Sheet{sheet.syncedAgo && !problem ? ` · sent ${sheet.syncedAgo}` : ""}
        {sheet.mode === "fill" && sheet.note && !problem ? ` · ${sheet.note}` : ""}
      </span>
      {problem && <span className="text-red-700">· Not sent: {problem}</span>}
      <button
        type="button"
        disabled={pending}
        className="text-accent-700 hover:underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await syncRunSheet(projectId, runId);
            setError(r.ok ? null : r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Sending…" : problem ? "Try again" : "Send to sheet"}
      </button>
    </p>
  );
}
