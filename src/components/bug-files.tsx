"use client";

import { useEffect, useRef, useState } from "react";
import { isDxdiag, isMedia } from "@/lib/bug-template";
import { tooBigForJira, tooBigLine } from "@/lib/jira-files";
import { Button, cx, InfoTip } from "./ui";
import { RECORD_AREA_LABEL, RECORD_AREA_NO, RECORD_AREA_TIP } from "./screen-capture";

/** A file the bug box can put on the Jira issue, with where it came from ("Step 3", "Whole case"). */
export type BugFile = { id: string; fileName: string; contentType: string; label?: string; /** Bytes, when known: files over Jira's limit are flagged. */ size?: number };

/** Take screenshot / Record screen from inside the bug box. */
export type BugCapture = { ok: boolean; why: string; busy: boolean; screenshot: () => void; record: () => void; /** Record an area, where the browser can. */ area: boolean; recordArea: () => void; /** "Sentry error…", when Sentry is connected. */ sentry?: () => void };

function Thumb({ f }: { f: BugFile }) {
  if (f.contentType.startsWith("image/"))
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/attachments/${f.id}`} alt="" className="size-8 shrink-0 rounded object-cover ring-1 ring-slate-200" />;
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded bg-slate-100 text-sm ring-1 ring-slate-200">
      {f.contentType.startsWith("video/") ? "🎥" : "📄"}
    </span>
  );
}

/** One file on the bug: a tick, a small preview, its name and the step it came from. */
export function FileTick({ f, on, onChange, note, jiraLimit = null }: { f: BugFile; on: boolean; onChange: (on: boolean) => void; note?: string; /** Jira's per-file limit, when filing to Jira. */ jiraLimit?: number | null }) {
  const big = jiraLimit !== null && tooBigForJira(f.size, jiraLimit);
  return (
    <label
      className={cx(
        "inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm",
        big ? "border-dashed border-amber-500 bg-amber-50" : on ? "border-accent-300 bg-accent-50/60" : "border-slate-200 bg-surface",
      )}
      data-testid="bug-file"
    >
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <Thumb f={f} />
      <span className="min-w-0 leading-tight">
        <span className="block max-w-56 truncate font-medium text-slate-800">{f.fileName}</span>
        {(f.label || note) && <small className="block text-xs text-slate-500">{[f.label, note].filter(Boolean).join(" · ")}</small>}
      </span>
      {big && (
        <small className="basis-full text-xs font-semibold text-amber-800" data-testid="too-big-for-jira">
          {tooBigLine(jiraLimit!)}
        </small>
      )}
    </label>
  );
}

/**
 * "+ Add ▾": files already taken in this case that aren't on the bug yet (tick
 * and Add), Take screenshot, Record screen and Upload a file.
 */
export function AddMenu({
  label,
  candidates,
  onPick,
  onUpload,
  accept,
  capture,
  uploading,
  what = "Screenshots and recordings",
}: {
  label: string;
  candidates: BugFile[];
  onPick: (files: BugFile[]) => void;
  onUpload: (files: File[]) => void;
  accept?: string;
  capture?: BugCapture;
  uploading: boolean;
  what?: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const wrap = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Files taken on other steps start ticked: they're why the menu was opened.
    setPicked(new Set(candidates.map((c) => c.id)));
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
    // Only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const n = candidates.filter((c) => picked.has(c.id)).length;
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-transparent";

  return (
    <span
      ref={wrap}
      className="relative inline-block"
      onKeyDown={(e) => {
        // Esc closes the menu, not the whole bug box.
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={uploading}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-dashed border-slate-400 bg-surface px-2.5 py-1 text-[13px] text-slate-700 hover:border-slate-500"
      >
        {uploading ? "Uploading…" : `${label} ▾`}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        aria-label={`${label}: upload a file`}
        onChange={(e) => {
          onUpload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {open && (
        <div role="menu" aria-label={label} className="absolute top-full left-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-surface p-1.5 shadow-lg">
          {candidates.length > 0 && (
            <>
              <p className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[11px] font-bold tracking-wider text-slate-600">
                FROM THIS CASE
                <InfoTip text={`${what} already added on other steps or the whole case in this run. Tick the ones to put on the bug.`} />
              </p>
              <div className="max-h-52 overflow-y-auto">
                {candidates.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={(e) =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                    />
                    <Thumb f={c} />
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-slate-800">{c.fileName}</span>
                      {c.label && <small className="block text-xs text-slate-500">{c.label}</small>}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end px-2 py-1">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!n}
                  onClick={() => {
                    onPick(candidates.filter((c) => picked.has(c.id)));
                    setOpen(false);
                  }}
                >
                  {n ? `Add ${n}` : "Add"}
                </Button>
              </div>
              <hr className="my-1 border-slate-200" />
            </>
          )}
          {capture && (
            <>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={!capture.ok || capture.busy}
                title={capture.ok ? "Pick a tab, window or screen, then add all of it or drag a box around just one part" : capture.why}
                onClick={() => {
                  setOpen(false);
                  capture.screenshot();
                }}
              >
                📷 Take screenshot
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={!capture.ok || capture.busy}
                title={capture.ok ? "Record a tab, window or screen for up to 5 minutes and add the video" : capture.why}
                onClick={() => {
                  setOpen(false);
                  capture.record();
                }}
              >
                🎥 Record screen
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={!capture.ok || !capture.area || capture.busy}
                title={!capture.ok ? capture.why : capture.area ? RECORD_AREA_TIP : RECORD_AREA_NO}
                onClick={() => {
                  setOpen(false);
                  capture.recordArea();
                }}
              >
                🔲 {RECORD_AREA_LABEL}
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            📁 Upload a file…
          </button>
          {capture?.sentry && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                capture.sentry!();
              }}
            >
              🛰 Sentry error…
            </button>
          )}
        </div>
      )}
    </span>
  );
}

/** The files on the bug as ticks, then "+ Add ▾": the plain bug box and an imported template. */
export function BugFiles({
  files,
  include,
  setInclude,
  candidates,
  onPick,
  onUpload,
  capture,
  uploading,
  jiraLimit = null,
}: {
  files: BugFile[];
  include: Set<string>;
  setInclude: (fn: (s: Set<string>) => Set<string>) => void;
  candidates: BugFile[];
  onPick: (files: BugFile[]) => void;
  onUpload: (files: File[]) => void;
  capture?: BugCapture;
  uploading: boolean;
  jiraLimit?: number | null;
}) {
  return (
    <fieldset data-howto="bug-files">
      <legend className="mb-1 text-xs font-medium text-slate-600">Attach to the Jira issue</legend>
      <FileTicks files={files} include={include} setInclude={setInclude} jiraLimit={jiraLimit}>
        <AddMenu label="+ Add" candidates={candidates} onPick={onPick} onUpload={onUpload} capture={capture} uploading={uploading} what="Screenshots, recordings and files" />
      </FileTicks>
    </fieldset>
  );
}

export function FileTicks({
  files,
  include,
  setInclude,
  history,
  children,
  jiraLimit = null,
}: {
  files: BugFile[];
  include: Set<string>;
  setInclude: (fn: (s: Set<string>) => Set<string>) => void;
  /** The team template lists files in its Reproduction History table, except DxDiag. */
  history?: boolean;
  children: React.ReactNode;
  jiraLimit?: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {files.map((f) => (
        <FileTick
          key={f.id}
          f={f}
          on={include.has(f.id)}
          jiraLimit={jiraLimit}
          note={history && isDxdiag(f.fileName) ? "not added to the history table" : undefined}
          onChange={(on) =>
            setInclude((s) => {
              const n = new Set(s);
              if (on) n.add(f.id);
              else n.delete(f.id);
              return n;
            })
          }
        />
      ))}
      {children}
    </div>
  );
}

export const splitFiles = (files: BugFile[]) => ({ media: files.filter((f) => isMedia(f.contentType)), logs: files.filter((f) => !isMedia(f.contentType)) });
