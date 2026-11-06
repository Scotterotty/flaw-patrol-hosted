"use client";

import { useEffect, useRef, useState } from "react";
import { EXPORT_FORMATS, FORMAT_INFO, isExportFormat, type ExportFormat } from "@/lib/case-export";
import { Modal } from "./modal";
import { Button, cx, ErrorText } from "./ui";

/** The Case library's table tells the Export cases box which cases are ticked. */
export const TICKED_EVENT = "fp:cases-ticked";
export function announceTicked(ids: string[]) {
  window.dispatchEvent(new CustomEvent(TICKED_EVENT, { detail: ids }));
}

/** What a "Which cases" choice sends to the export route. */
export type ExportScope = { label: string; scope: "ids" | "folder" | "suite" | "all"; ids?: string[]; folder?: string; suiteId?: string; archived?: boolean };

const FORMAT_KEY = "fp-export-format";
const TOOLS: ExportFormat[] = EXPORT_FORMATS.filter((f) => f !== "sheet");

/**
 * Export cases (ver_190): pick which cases and where they're going, then Download.
 * Ticked cases come first when there are any. The last format is remembered just for you;
 * the first time it's Excel or Google Sheets.
 */
export function ExportCasesButton({ projectKey, scopes, look = "button" }: { projectKey: string; scopes: ExportScope[]; look?: "button" | "menu" }) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [which, setWhich] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("sheet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // The download link goes inside the open box: the page behind a modal box ignores it.
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const on = (e: Event) => setTicked((e as CustomEvent<string[]>).detail ?? []);
    window.addEventListener(TICKED_EVENT, on);
    return () => window.removeEventListener(TICKED_EVENT, on);
  }, []);
  // Ctrl+K "Export cases" opens the box with ?export=1.
  useEffect(() => {
    if (look !== "button") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("export") !== "1") return;
    url.searchParams.delete("export");
    window.history.replaceState(null, "", url);
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choices: ExportScope[] = [...(ticked.length ? [{ label: `The ${ticked.length === 1 ? "1 case" : `${ticked.length}`} you ticked`, scope: "ids" as const, ids: ticked }] : []), ...scopes];

  function show() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(FORMAT_KEY);
    } catch {}
    setFormat(isExportFormat(saved) ? saved : "sheet");
    setWhich(0);
    setError(null);
    setDone(null);
    setOpen(true);
  }

  async function download() {
    const pick = choices[which] ?? choices[0];
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem(FORMAT_KEY, format);
      } catch {}
      const res = await fetch(`/p/${projectKey}/cases/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, scope: pick.scope, ids: pick.ids, folder: pick.folder, suiteId: pick.suiteId, archived: pick.archived, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      if (!res.ok) throw new Error((await res.text()) || "The export didn't work. Try again.");
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "") || `cases.${FORMAT_INFO[format].ext}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      (form.current ?? document.body).appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const n = Number(res.headers.get("X-Case-Count")) || 0;
      setDone(`Downloaded ${n === 1 ? "1 case" : `${n} cases`}${format === "sheet" ? "" : `. In ${FORMAT_INFO[format].tool}, go to ${FORMAT_INFO[format].hint}`}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The export didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const option = (id: string, name: string, checked: boolean, onPick: () => void, title: string, sub?: string) => (
    <label
      key={id}
      htmlFor={id}
      className={cx(
        "flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm",
        checked ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : "border-slate-200 hover:bg-slate-50",
      )}
    >
      <input id={id} type="radio" name={name} checked={checked} onChange={onPick} className="mt-0.5 accent-[var(--color-accent-600)]" />
      <span>
        <span className="font-medium text-slate-900">{title}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
    </label>
  );

  return (
    <>
      {look === "menu" ? (
        <Button variant="ghost" role="menuitem" onClick={show} data-howto="suite-export">
          Export cases…
        </Button>
      ) : (
        <Button onClick={show} data-howto="cases-export">
          Export cases
        </Button>
      )}
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Export cases" locked={busy}>
        <form
          ref={form}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void download();
          }}
        >
          <fieldset className="space-y-1.5" data-howto="export-which">
            <legend className="mb-1.5 text-xs font-semibold text-slate-600">Which cases</legend>
            <div className="flex flex-wrap gap-2">{choices.map((c, i) => option(`export-which-${i}`, "export-which", which === i, () => setWhich(i), c.label))}</div>
          </fieldset>
          <fieldset className="space-y-1.5" data-howto="export-format">
            <legend className="mb-1.5 text-xs font-semibold text-slate-600">Open it in</legend>
            {option("export-format-sheet", "export-format", format === "sheet", () => setFormat("sheet"), FORMAT_INFO.sheet.label, `.xlsx · ${FORMAT_INFO.sheet.hint}`)}
            <p className="pt-1.5 text-xs font-semibold text-slate-600">Or bring it into another test tool</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TOOLS.map((f) => option(`export-format-${f}`, "export-format", format === f, () => setFormat(f), FORMAT_INFO[f].label, `.${FORMAT_INFO[f].ext} · ${FORMAT_INFO[f].hint}`))}
            </div>
          </fieldset>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {done && (
            <p className="text-sm text-emerald-700" role="status">
              ✓ {done}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} disabled={busy}>
              {done ? "Close" : "Cancel"}
            </Button>
            <Button variant="primary" type="submit" disabled={busy} data-howto="export-download">
              {busy ? "Downloading…" : "Download"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
