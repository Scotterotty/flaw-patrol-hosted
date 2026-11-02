"use client";

import { useCallback, useEffect, useState } from "react";
import { sentryBuildStats } from "@/server/sentry";
import { Card } from "./ui";

type Stats = { release: string | null; build: string; crashFree: number | null; fresh: number | null; found: number; inBugs: number; newUrl: string | null; releaseUrl: string | null; at: string };

/**
 * How the build is doing in Sentry, on a run page and Reports → RC status:
 * crash-free sessions, new errors in this build, errors found during the run(s) and
 * how many of those are already in bugs. Loads after the page, so a slow Sentry never
 * holds the page up.
 */
export function SentryCard({ projectId, runIds }: { projectId: string; runIds: string[] }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    void sentryBuildStats(projectId, runIds).then((r) => {
      setLoading(false);
      if (!r.ok) return setError(r.error);
      setError(null);
      setStats(r.stats);
    });
    // runIds is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, runIds.join(",")]);
  useEffect(load, [load]);
  if (!loading && !stats && !error) return null;
  const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(1)}%`);
  const ago = stats ? Math.max(0, Math.round((Date.now() - Date.parse(stats.at)) / 60000)) : 0;
  const tile = (value: string, label: string, href?: string | null) => {
    const inner = (
      <>
        <span className="block text-xl font-semibold text-slate-900 tabular-nums">{value}</span>
        <span className="block text-xs text-slate-500">{label}</span>
      </>
    );
    return href ? (
      <a href={href} target="_blank" rel="noreferrer" className="rounded-md px-2 py-1 hover:bg-slate-50">
        {inner}
      </a>
    ) : (
      <span className="px-2 py-1">{inner}</span>
    );
  };
  return (
    <Card className="p-4" data-testid="sentry-card">
      <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-800">Sentry{stats?.build ? ` · Build ${stats.build}` : ""}</span>
        <span className="text-xs text-slate-500">
          {loading ? "Asking Sentry…" : `updated ${ago ? `${ago} min ago` : "just now"}`} ·{" "}
          <button type="button" className="text-accent-700 hover:underline" onClick={load}>
            Refresh
          </button>
        </span>
      </p>
      {error && <p className="text-sm text-slate-500">Sentry: {error}</p>}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile(pct(stats.crashFree), "crash-free sessions", stats.releaseUrl)}
            {tile(stats.fresh === null ? "–" : String(stats.fresh), "new errors in this build", stats.newUrl)}
            {tile(String(stats.found), "errors found during this run")}
            {tile(String(stats.inBugs), "of those already in Jira bugs")}
          </div>
          {!stats.release && <p className="mt-2 text-xs text-slate-500">No Sentry release matches this run&apos;s build, so build numbers are blank. Errors found during the run still count.</p>}
        </>
      )}
    </Card>
  );
}
