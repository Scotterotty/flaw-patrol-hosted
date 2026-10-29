"use client";

import { useState, useTransition } from "react";
import type { SentryRef } from "@/lib/sentry";
import { searchSentry } from "@/server/sentry";
import { Button, cx, ErrorText, Input } from "./ui";

export type StepSentry = { loading: boolean; errors: SentryRef[]; picked: string[]; searchUrl: string; onlyYours?: boolean; error?: string };

const when = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const today = d.toDateString() === new Date().toDateString();
  return today ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * In the runner under a Failed or Blocked step (ver_96): the errors Sentry caught while
 * you were on it. Tick the ones that belong to this problem; they go into the bug box
 * and stay with the step result.
 */
export function SentryStepBox({ data, onPick, onFile, canFile }: { data: StepSentry; onPick: (ids: string[]) => void; onFile: () => void; canFile: boolean }) {
  if (data.loading) return <p className="text-xs text-slate-500">Asking Sentry for errors during this step…</p>;
  if (data.error) return <p className="text-xs text-slate-500">Sentry: {data.error}</p>;
  if (!data.errors.length) return null;
  const picked = new Set(data.picked);
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2.5 text-sm" data-testid="sentry-step-box">
      <p className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-800">
          Sentry caught {data.errors.length} {data.errors.length === 1 ? "error" : "errors"} during this step
          {data.onlyYours === false && <span className="font-normal text-slate-500"> · everyone&apos;s</span>}
        </span>
        {data.searchUrl && (
          <a href={data.searchUrl} target="_blank" rel="noreferrer" className="text-xs text-accent-700 hover:underline">
            Open in Sentry ↗
          </a>
        )}
      </p>
      <ul className="space-y-1">
        {data.errors.map((e) => (
          <li key={e.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-white/60">
              <input
                type="checkbox"
                className="mt-1 accent-accent-600"
                checked={picked.has(e.id)}
                onChange={(ev) => onPick(ev.target.checked ? [...picked, e.id] : [...picked].filter((x) => x !== e.id))}
              />
              <span className="min-w-0">
                <span className="block font-mono text-[13px] wrap-anywhere text-slate-900">{e.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className={cx("rounded-full px-1.5 font-semibold", e.fresh ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600")}>{e.fresh ? "New in this build" : "Seen before"}</span>
                  {[e.project, e.frames[0], `${e.count} ${e.count === 1 ? "time" : "times"}`, when(e.firstSeen) && `first seen ${when(e.firstSeen)}`].filter(Boolean).join(" · ")}
                  <a href={e.url} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
                    {e.shortId} ↗
                  </a>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!picked.size || !canFile} onClick={onFile}>
          File a bug with {picked.size} {picked.size === 1 ? "error" : "errors"}
        </Button>
        <span className="text-xs text-slate-500">Ticked errors go into the bug box.</span>
      </div>
    </div>
  );
}

/** The Sentry errors section in the bug box, with "Sentry error…" search from + Add. */
export function SentryBugSection({ projectId, entryId, list, setList, searching, setSearching, jira = true }: { jira?: boolean; projectId: string; entryId: string; list: SentryRef[]; setList: (fn: (l: SentryRef[]) => SentryRef[]) => void; searching: boolean; setSearching: (on: boolean) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<SentryRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!list.length && !searching) return null;
  return (
    <div className="rounded-md border border-slate-200 p-2.5" data-testid="bug-sentry">
      <p className="mb-1 text-xs font-semibold text-slate-700">Sentry errors</p>
      {!searching && list.length > 0 && <p className="mb-1 text-xs text-slate-500">{jira ? "They go at the end of the bug\u2019s description in Jira, and stay with the step result." : "They stay with the step result when you save the case."}</p>}
      {list.map((e) => (
        <div key={e.id} className="flex items-start justify-between gap-2 py-0.5 text-sm">
          <span className="min-w-0">
            <span className="block font-mono text-[13px] wrap-anywhere text-slate-900">{e.title}</span>
            <span className="text-xs text-slate-500">
              {e.shortId} · {e.project} · {e.count} {e.count === 1 ? "time" : "times"}
            </span>
          </span>
          <button type="button" aria-label={`Remove ${e.shortId}`} className="text-slate-400 hover:text-slate-800" onClick={() => setList((l) => l.filter((x) => x.id !== e.id))}>
            ×
          </button>
        </div>
      ))}
      {searching && (
        <div className="mt-2 space-y-1.5">
          <form
            className="flex gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              start(async () => {
                setError(null);
                const r = await searchSentry(projectId, entryId, q);
                if (!r.ok) return setError(r.error);
                setFound(r.errors);
              });
            }}
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sentry ID, link or words from the error" aria-label="Find a Sentry error" className="h-8" autoFocus />
            <Button size="sm" type="submit" disabled={pending || !q.trim()}>
              {pending ? "Looking…" : "Find"}
            </Button>
            <Button size="sm" onClick={() => (setSearching(false), setFound(null))}>
              Done
            </Button>
          </form>
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          {found?.length === 0 && <p className="text-xs text-slate-500">Nothing in the last 14 days matches.</p>}
          {found?.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={list.some((x) => x.id === e.id)}
              onClick={() => setList((l) => [...l, e])}
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="font-mono text-[13px]">{e.title}</span> <span className="text-xs text-slate-500">· {e.shortId}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
