"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { getSheetScript, linkRunSheet, setRunSheetAuto, syncRunSheet, unlinkRunSheet } from "@/server/run-sheet";
import { Modal } from "./modal";
import { Button, ErrorText, Field, Input } from "./ui";

export type SheetState = { hook: string | null; tab: string; auto: boolean; link: string; syncedAgo: string | null; error: string };

/** "Google Sheet" in a run's More menu: link a sheet tab, then send the run's results to it on demand or as they're saved. */
export function RunSheetButton({ projectId, runId, runName, sheet }: { projectId: string; runId: string; runName: string; sheet: SheetState }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept in state so a failed attempt doesn't clear what was pasted.
  const [hook, setHook] = useState(sheet.hook ?? "");
  const [tab, setTab] = useState(sheet.tab || runName.slice(0, 100));
  const [auto, setAuto] = useState(sheet.auto);
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

  return (
    <>
      <Button variant="ghost" onClick={show}>
        Google Sheet
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send results to a Google Sheet" wide>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {linked ? (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              Linked to the <strong>{sheet.tab}</strong> tab{sheet.syncedAgo ? `, last sent ${sheet.syncedAgo}` : ""}. Sending replaces the tab&apos;s words with the run&apos;s current
              results.
            </p>
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
              act(
                () => linkRunSheet(projectId, runId, { hook, tab, auto }),
                () => setOpen(false),
              );
            }}
          >
            <ol className="list-decimal space-y-3 pl-5 text-slate-700">
              <li>
                In the Google Sheet, open <strong>Extensions › Apps Script</strong>. Replace what&apos;s there with this script and save.
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    disabled={!script}
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
                  <span className="text-xs text-slate-500">It only accepts results from this test cycle.</span>
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
              <Input id="sheet-hook" required value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
            </Field>
            <Field label="Tab" htmlFor="sheet-tab" hint="Made if it doesn't exist. Each send rewrites the tab in your cycle sheet's look; column widths and hidden columns you set stay.">
              <Input id="sheet-tab" required value={tab} onChange={(e) => setTab(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-slate-700">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Send automatically each time a result is saved
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => (sheet.hook ? setEditing(false) : setOpen(false))}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Sending…" : "Link and send"}
              </Button>
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
