"use client";

import { NewsTag } from "./case-news-tag";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutoStepRow } from "@/lib/automation-files";
import { linkAutomationBug } from "@/server/automation";
import type { LinkedDefect } from "@/server/jira";
import { FlakyBadge } from "./badges";
import { BugDialog } from "./bug-dialog";
import { StatusChip } from "./status";
import { Button, cx } from "./ui";

export type AutoFileKind = "screenshot" | "video" | "trace";
export type AutoFileRow = { id: string; kind: AutoFileKind; fileName: string; contentType: string; size: number; attempt?: number | null };

/**
 * Each file's attempt. Playwright retries a failed test and keeps a screenshot,
 * video and replay per try. Files saved before ver_95 have no attempt, so they're
 * guessed from their order: Playwright saves the attempts in order.
 */
export function withAttempts(files: AutoFileRow[]): (AutoFileRow & { attempt: number })[] {
  if (files.every((f) => f.attempt != null)) return files.map((f) => ({ ...f, attempt: f.attempt! }));
  const seen = new Map<AutoFileKind, number>();
  return files.map((f) => {
    const n = (seen.get(f.kind) ?? 0) + 1;
    seen.set(f.kind, n);
    return { ...f, attempt: f.attempt ?? n };
  });
}

const attemptsIn = (files: AutoFileRow[]) => [...new Set(withAttempts(files).map((f) => f.attempt))].sort((a, b) => a - b);

export type AutoRow = {
  entryId: string;
  resultId: string | null;
  caseKey: string;
  caseHref: string;
  title: string;
  status: string;
  automationId: string;
  message: string;
  stack: string;
  output: string;
  durationMs: number | null;
  flaky: number;
  /** New or Updated since its last run. */
  news?: "new" | "updated";
  before: { status: string; run: number; label: string } | null;
  bugs: LinkedDefect[];
  /** Screenshots, videos and replays. */
  files: AutoFileRow[];
  steps: AutoStepRow[];
};

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The automated run's tests: failures first, each with what to do next. */
export function AutomatedResults({
  projectId,
  projectKey,
  runNumber,
  rows,
  canFile,
  jiraConnected,
  filesDeletedBy = null,
}: {
  projectId: string;
  projectKey: string;
  runNumber: number;
  rows: AutoRow[];
  canFile: boolean;
  jiraConnected: boolean;
  filesDeletedBy?: string | null;
}) {
  const router = useRouter();
  const failed = rows.filter((r) => r.status === "FAILED").length;
  const skipped = rows.filter((r) => r.status === "SKIPPED").length;
  const [filter, setFilter] = useState<"FAILED" | "SKIPPED" | "ALL">(failed ? "FAILED" : "ALL");
  const [bugFor, setBugFor] = useState<AutoRow | null>(null);
  // The attempt each test is showing; File bug attaches only that attempt's files.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const shownFiles = (r: AutoRow) => {
    const all = withAttempts(r.files);
    const tries = attemptsIn(r.files);
    const at = picked[r.entryId] ?? tries.at(-1);
    return tries.length > 1 ? all.filter((f) => f.attempt === at) : all;
  };
  const shown = rows.filter((r) => filter === "ALL" || r.status === filter);
  const recent = [...new Map(rows.flatMap((r) => r.bugs).map((b) => [b.id, b])).values()];

  return (
    <>
      <div className="mb-3 flex gap-1 border-b border-slate-200 text-sm" role="tablist" aria-label="Show">
        {(
          [
            ["FAILED", `Failed ${failed}`],
            ["SKIPPED", `Skipped ${skipped}`],
            ["ALL", `All ${rows.length}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cx("-mb-px border-b-2 px-3 py-2", filter === k ? "border-accent-600 font-medium text-accent-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
            {label}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-surface" aria-label="Test results">
        {shown.slice(0, 500).map((r) => (
          <li key={r.entryId} className="px-4 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <StatusChip status={r.status as never} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={r.caseHref} className="font-mono text-xs text-accent-700 hover:underline">
                    {r.caseKey}
                  </Link>
                  <span className="font-medium text-slate-900">{r.title}</span>
                  {r.flaky > 0 && <FlakyBadge flips={r.flaky} />}
                  {r.news && <NewsTag kind={r.news} title={r.news === "new" ? "First time this test is in a run" : "Steps changed since its last run"} />}
                  <FileIcons files={r.files} />
                  {attemptsIn(r.files).length > 1 && <span className="text-[11px] text-slate-500">· {attemptsIn(r.files).length} attempts</span>}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={r.automationId}>
                  {[r.automationId, r.durationMs != null && secs(r.durationMs), r.before && `${r.before.status === r.status ? "also " : ""}${r.before.status.toLowerCase().replace("_", " ")} in ${r.before.label}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              {r.bugs.map((b) =>
                b.externalUrl ? (
                  <a key={b.id} href={b.externalUrl} target="_blank" rel="noreferrer" className="rounded bg-red-50 px-2 py-0.5 font-mono text-xs text-red-700 hover:underline" title={b.title}>
                    🐞 {b.externalKey}
                  </a>
                ) : (
                  <span key={b.id} className="rounded bg-red-50 px-2 py-0.5 font-mono text-xs text-red-700" title={b.title}>
                    🐞 D-{b.number}
                  </span>
                ),
              )}
              {r.status === "FAILED" && canFile && r.resultId && (
                <Button size="sm" onClick={() => setBugFor(r)}>
                  File bug
                </Button>
              )}
            </div>
            {r.message && <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 px-3 py-2 text-xs whitespace-pre-wrap text-slate-800">{r.message}</pre>}
            {(r.files.length > 0 || r.steps.length > 0) &&
              (r.status === "FAILED" ? (
                <Media row={r} projectKey={projectKey} runNumber={runNumber} picked={picked[r.entryId]} onPick={(n) => setPicked((p) => ({ ...p, [r.entryId]: n }))} />
              ) : (
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer text-accent-700 hover:underline">Show {r.files.length ? "screenshots, video and replay" : "what the test did"}</summary>
                  <Media row={r} projectKey={projectKey} runNumber={runNumber} picked={picked[r.entryId]} onPick={(n) => setPicked((p) => ({ ...p, [r.entryId]: n }))} />
                </details>
              ))}
            {filesDeletedBy && r.status === "FAILED" && !r.files.length && <p className="mt-1 text-[11px] text-slate-500">Files deleted by {filesDeletedBy}</p>}
            {(r.stack || r.output) && (
              <div className="mt-1 flex flex-wrap gap-4 text-xs">
                {r.stack && <Fold label="Show stack trace" text={r.stack} />}
                {r.output && <Fold label={`Show console output (${r.output.split("\n").length} lines)`} text={r.output} />}
              </div>
            )}
          </li>
        ))}
        {shown.length > 500 && <li className="px-4 py-2 text-xs text-slate-500">Showing 500 of {shown.length}.</li>}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">{filter === "FAILED" ? "Nothing failed. 🎉" : "Nothing here."}</li>}
      </ul>
      {bugFor && (
        <BugDialog
          open
          onClose={() => setBugFor(null)}
          onLinked={async (d) => {
            await linkAutomationBug(projectId, bugFor.resultId!, d.id);
            router.refresh();
          }}
          projectId={projectId}
          entryId={bugFor.entryId}
          stepIndex={null}
          stepLabel="whole case"
          actual={[
            bugFor.message,
            bugFor.stack && `Stack trace:\n${bugFor.stack}`,
            `Automation ID: ${bugFor.automationId}`,
            ...shownFiles(bugFor).filter((f) => f.kind === "trace").map((f) => `Step-by-step replay: ${typeof window === "undefined" ? "" : window.location.origin}${replayHref(projectKey, f.id)}`),
          ]
            .filter(Boolean)
            .join("\n\n")}
          suggested={`${bugFor.title}: ${bugFor.message.split("\n")[0]}`.slice(0, 250)}
          attachments={shownFiles(bugFor).filter((f) => f.kind !== "trace").map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, label: f.kind === "video" ? "Video of the test" : "Screenshot when it failed" }))}
          jiraConnected={jiraConnected}
          recent={recent}
        />
      )}
    </>
  );
}

function Fold({ label, text }: { label: string; text: string }) {
  return (
    <details className="w-full">
      <summary className="cursor-pointer text-accent-700 hover:underline">{label}</summary>
      <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-900 px-3 py-2 text-[11px] whitespace-pre-wrap text-slate-100">{text}</pre>
    </details>
  );
}

export const replayHref = (projectKey: string, fileId: string) => `/p/${projectKey}/replay/${fileId}`;

/** 📷 1 🎬 1 ▶ replay, so the rows with pictures stand out. */
function FileIcons({ files }: { files: AutoFileRow[] }) {
  const n = (k: AutoFileKind) => files.filter((f) => f.kind === k).length;
  if (!files.length) return null;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-500" data-testid="file-icons">
      {n("screenshot") > 0 && <span title="Screenshots">📷 {n("screenshot")}</span>}
      {n("video") > 0 && <span title="Videos">🎬 {n("video")}</span>}
      {n("trace") > 0 && <span title="Step-by-step replay">▶ replay</span>}
    </span>
  );
}

const ms = (n: number | null) => (n == null ? "" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);

/** The screenshot, video and replay, and what the test did. */
function Media({ row, projectKey, runNumber, picked, onPick }: { row: AutoRow; projectKey: string; runNumber: number; picked?: number; onPick: (n: number) => void }) {
  // One attempt at a time, the last one first; the switch only shows when a test was retried.
  const tries = attemptsIn(row.files);
  const last = tries.at(-1);
  const at = picked && tries.includes(picked) ? picked : last;
  const files = tries.length > 1 ? withAttempts(row.files).filter((f) => f.attempt === at) : row.files;
  const shots = files.filter((f) => f.kind === "screenshot");
  const videos = files.filter((f) => f.kind === "video");
  const traces = files.filter((f) => f.kind === "trace");
  const failedAll = row.status === "FAILED";
  return (
    <>
    {tries.length > 1 && (
      <div className="mt-2 flex flex-wrap items-center gap-3" data-testid="attempts">
        <div className="inline-flex rounded-md border border-slate-200 bg-surface p-0.5 text-xs" role="tablist" aria-label="Attempt">
          {tries.map((n) => (
            <button key={n} type="button" role="tab" aria-selected={n === at} onClick={() => onPick(n)} className={cx("rounded px-2.5 py-1", n === at ? "bg-accent-600 font-medium text-white" : "text-slate-600 hover:bg-slate-100")}>
              Attempt {n}
              {n === last ? " (last)" : ""}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">
          {failedAll
            ? `Failed ${tries.length === 2 ? "both attempts" : `all ${tries.length} attempts`}, so this looks like a real bug, not a flaky test.`
            : `Failed on attempt ${tries.at(-2)}, passed on attempt ${last}.`}
        </p>
      </div>
    )}
    <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_1fr]" data-testid="test-media">
      {(shots.length > 0 || videos.length > 0) && (
        <div className="space-y-2">
          {shots.map((f) => (
            <figure key={f.id}>
              <a href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" title="Open full size">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/attachments/${f.id}`} alt={`Screenshot: ${row.title}`} className="max-h-64 rounded border border-slate-200 object-contain" loading="lazy" />
              </a>
              <figcaption className="mt-0.5 text-[11px] text-slate-500">
                📷 Screenshot when it {row.status === "FAILED" ? "failed" : "ran"}
                {tries.length > 1 ? ` (attempt ${at})` : ""} ·{" "}
                <a href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                  Open full size
                </a>
              </figcaption>
            </figure>
          ))}
          {videos.map((f) => (
            <figure key={f.id}>
              <video src={`/api/attachments/${f.id}`} controls preload="metadata" className="max-h-64 w-full rounded border border-slate-200 bg-black" />
              <figcaption className="mt-0.5 text-[11px] text-slate-500">🎬 Video of the whole test{tries.length > 1 ? ` (attempt ${at})` : ""}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {traces.map((f, i) => (
          <div key={f.id}>
            <a href={replayHref(projectKey, f.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
              ▶ Open step-by-step replay{traces.length > 1 ? ` ${i + 1}` : ""}{tries.length > 1 ? ` of attempt ${at}` : ""}
            </a>
            <p className="mt-1 text-[11px] text-slate-500">The replay shows every click and check the test made, with the page as it looked at each one.</p>
          </div>
        ))}
        {row.steps.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">What the test did</p>
            <ol className="space-y-0.5 text-xs" aria-label="What the test did">
              {row.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-label={s.ok ? "passed" : "failed"} className={s.ok ? "text-st-passed-ink" : "font-bold text-st-failed-ink"}>
                    {s.ok ? "✓" : "✕"}
                  </span>
                  <span className={s.ok ? "text-slate-700" : "font-medium text-red-800"}>{s.title}</span>
                  <span className="ml-auto text-slate-400 tabular-nums">{ms(s.ms)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {row.files.length > 1 && (
          <a href={`/api/results/${row.resultId}/files?run=${runNumber}`} className="inline-block text-xs text-accent-700 hover:underline">
            Download all files ({row.files.length}{tries.length > 1 ? `, all ${tries.length} attempts` : ""})
          </a>
        )}
      </div>
    </div>
    </>
  );
}
