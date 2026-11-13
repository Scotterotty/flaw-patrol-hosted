"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { count, relativeTime } from "@/lib/format";
import { buildNumber, updateBlocked, type ServerUpdateView } from "@/lib/server-update";
import { requestServerUpdate, requestUpdateCheck } from "@/server/server-update";
import { Badge, Button, Card, ErrorText } from "./ui";

type View = ServerUpdateView & { running: string };

const SHOWN_COMMITS = 8;
const ago = (iso: string | null) => (iso ? relativeTime(new Date(iso)) : "never");

/**
 * Workspace settings → Updates (ver_238): the version this server runs, what's new on GitHub,
 * and an Update now button that hands the work to the update helper on the server
 * (scripts/server-update.sh). While it updates, the card asks every few seconds how it's going,
 * and keeps asking through the restart, when Flaw Patrol is away for a moment.
 */
export function WorkspaceUpdates({ initial }: { initial: View }) {
  const [view, setView] = useState<View>(initial);
  const [away, setAway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = view.status?.state === "updating" || view.waiting !== null;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/server-update", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setView(await res.json());
      setAway(false);
    } catch {
      // Flaw Patrol restarting answers nothing for a few seconds.
      setAway(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, busy || away ? 4000 : 30_000);
    return () => clearInterval(id);
  }, [busy, away, refresh]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.error ?? "Something went wrong."));
      await refresh();
    });

  const { remote, status } = view;
  const newer = remote && !remote.error ? remote.behind : 0;
  const blocked = updateBlocked(view);
  const nowRunning = view.running !== initial.running;
  const latestBuild = remote?.latest ? buildNumber(remote.latest) : null;

  return (
    <Card id="updates" data-howto="workspace-updates" className="scroll-mt-28 p-5" role="region" aria-labelledby="updates-heading">
      <h2 id="updates-heading" className="text-sm font-semibold text-slate-800">
        Updates
      </h2>
      <p className="mt-1 text-sm text-slate-600">Update Flaw Patrol on this server to the newest code on GitHub. Only workspace admins can.</p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

      {view.problem === "none" ? (
        <NotSetUp />
      ) : (
        <div className="mt-3 grid gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-slate-500">Running now</dt>
              <dd className="font-mono" data-testid="update-running">
                {view.running}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Newest on GitHub</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {remote?.error ? (
                  <span className="text-red-700">{remote.error}</span>
                ) : remote?.latest ? (
                  <>
                    <span className="font-mono">{remote.latest}</span>
                    {newer > 0 ? <Badge tone="blue">{count(newer, "new change")}</Badge> : <Badge tone="green">Up to date</Badge>}
                  </>
                ) : (
                  <span className="text-slate-500">Not checked yet</span>
                )}
              </dd>
            </div>
          </dl>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>Checked {ago(remote?.checked ?? null)}</span>
            <button
              type="button"
              className="font-medium text-accent-700 hover:underline disabled:opacity-50"
              disabled={pending || busy || view.problem === "folder"}
              onClick={() => act(requestUpdateCheck)}
            >
              {view.waiting === "check" ? "Checking…" : "Check now"}
            </button>
          </p>

          {view.problem === "folder" && (
            <Problem title="Flaw Patrol can't reach the update helper's folder">
              On the server, in the Flaw Patrol folder, run <Code>sudo scripts/server-update.sh install</Code>, then{" "}
              <Code>docker compose -f docker-compose.hosting.yml up -d</Code>.
            </Problem>
          )}
          {view.problem === "helper" && (
            <Problem title="The update helper isn't running">
              It was last seen {ago(view.helperSeen)}. On the server, run <Code>sudo systemctl start flaw-patrol-updater</Code>, or{" "}
              <Code>sudo scripts/server-update.sh install</Code> if it was never set up.
            </Problem>
          )}
          {remote && remote.changed.length > 0 && !busy && (
            <Problem title="The server's copy of the code has its own changes">
              {remote.changed.join(", ")}. An update stops if the new code changes the same files. Ask whoever runs the server to undo or commit them.
            </Problem>
          )}

          {newer > 0 && view.commits.length > 0 && !busy && (
            <details className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">What&apos;s coming{latestBuild ? ` in ${latestBuild}` : ""}</summary>
              <ul className="mt-2 grid gap-1">
                {view.commits.slice(0, SHOWN_COMMITS).map((c) => (
                  <li key={c.sha} className="flex gap-2">
                    <span className="shrink-0 font-mono text-xs text-slate-400">{c.sha}</span>
                    <span className="min-w-0">{c.subject}</span>
                  </li>
                ))}
              </ul>
              {view.commits.length > SHOWN_COMMITS && <p className="mt-1 text-xs text-slate-500">and {count(view.commits.length - SHOWN_COMMITS, "more change")}</p>}
            </details>
          )}
          {newer > 0 && view.migrations.length > 0 && !busy && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
              Includes {count(view.migrations.length, "database change")}. They apply by themselves when Flaw Patrol restarts, after a backup of the database.
            </p>
          )}

          {busy ? (
            <div className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 ring-1 ring-sky-200" role="status" aria-live="polite">
              <p className="flex items-center gap-2 font-medium">
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" aria-hidden />
                {away ? "Flaw Patrol is restarting…" : view.waiting === "update" ? "Waiting for the update helper…" : status?.step || "Updating…"}
              </p>
              <p className="mt-1 text-xs">Keep working; Flaw Patrol stays open while the new version builds and is away for a few seconds when it restarts.</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={pending || !!blocked || newer === 0}
                onClick={() => {
                  const extra = view.migrations.length ? ` It includes ${count(view.migrations.length, "database change")}.` : "";
                  if (window.confirm(`Update Flaw Patrol to ${remote?.latest || "the newest code"}? It takes about 4 minutes and is away for a few seconds when it restarts.${extra}`)) act(requestServerUpdate);
                }}
              >
                Update now
              </Button>
              {blocked && view.problem === null && <span className="text-xs text-slate-500">{blocked}</span>}
            </div>
          )}

          {nowRunning && (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200" role="status">
              This server now runs {view.running}.{" "}
              <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>
                Reload
              </button>{" "}
              to use it.
            </p>
          )}

          {status && status.state !== "idle" && status.state !== "updating" && (
            <div className="text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">Last update</span>
                {status.state === "done" ? <Badge tone="green">Done</Badge> : <Badge tone="red">Didn&apos;t finish</Badge>}
                <span className="text-xs text-slate-500">
                  {ago(status.finished)}
                  {status.by ? ` · started by ${status.by}` : ""}
                </span>
              </p>
              {status.message && <p className={status.state === "failed" ? "mt-1 text-red-700" : "mt-1 text-slate-600"}>{status.message}</p>}
              {status.backup && <p className="mt-1 text-xs text-slate-500">Database backup from before: <span className="font-mono">{status.backup}</span></p>}
            </div>
          )}

          {view.log && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-slate-500">Log from the last update</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs whitespace-pre-wrap text-slate-100">{view.log}</pre>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-800">{children}</code>;
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" role="note">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function NotSetUp() {
  return (
    <div className="mt-3 text-sm text-slate-600">
      <p>Updates work on a server that runs Flaw Patrol with Docker (docker-compose.hosting.yml). To set them up, someone with access to the server:</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Gives the server a read-only deploy key for the GitHub repository.</li>
        <li>
          Runs <Code>sudo scripts/server-update.sh install</Code> in the Flaw Patrol folder.
        </li>
        <li>
          Restarts Flaw Patrol once with <Code>docker compose -f docker-compose.hosting.yml up -d</Code>.
        </li>
      </ol>
      <p className="mt-2">The README&apos;s &quot;Update button&quot; section has the details.</p>
    </div>
  );
}
