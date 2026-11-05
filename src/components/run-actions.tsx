"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeRunNote, untestedLine } from "@/lib/close-run";
import { closeRunCheck, deleteRun, setRunState } from "@/server/runs";
import { Modal } from "./modal";
import { Button } from "./ui";

type Ask = { open: number; total: number; names: string[] };

/**
 * Close run, asking first when cases haven't been tested. One click as before when
 * every case has a result, and for automated runs. Returns the click handler and the question box.
 */
function useCloseRun(projectId: string, runId: string, onClosed?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<Ask | null>(null);
  const close = () =>
    start(async () => {
      await setRunState(projectId, runId, "COMPLETED");
      setAsk(null);
      onClosed?.();
      router.refresh();
    });
  const click = () =>
    start(async () => {
      const res = await closeRunCheck(projectId, runId);
      if (res.ok && res.open > 0) return setAsk(res);
      await setRunState(projectId, runId, "COMPLETED");
      onClosed?.();
      router.refresh();
    });
  const box = (
    <Modal open={!!ask} onClose={() => setAsk(null)} title="Close this run?" locked={pending}>
      {ask && (
        <div className="space-y-4 text-sm text-slate-700" data-testid="close-run-ask">
          <p>
            <b className="text-slate-900">{untestedLine(ask.open, ask.total)}</b> {closeRunNote(ask.names)}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setAsk(null)} disabled={pending}>
              Keep it open
            </Button>
            <Button variant="primary" onClick={close} disabled={pending}>
              {pending ? "Closing…" : "Close anyway"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
  return { click, box, pending };
}

export function RunStateButtons({
  projectId,
  projectKey,
  runId,
  state,
  canClose = true,
  canDelete = true,
}: {
  projectId: string;
  projectKey: string;
  runId: string;
  state: "ACTIVE" | "COMPLETED";
  canClose?: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const closing = useCloseRun(projectId, runId);
  const busy = pending || closing.pending;
  return (
    <>
      {canClose && (
        <Button
          disabled={busy}
          data-howto={state === "ACTIVE" ? "run-close" : "run-reopen"}
          onClick={() =>
            state === "ACTIVE"
              ? closing.click()
              : start(async () => {
                  await setRunState(projectId, runId, "ACTIVE");
                  router.refresh();
                })
          }
        >
          {state === "ACTIVE" ? "Close run" : "Reopen run"}
        </Button>
      )}
      {canClose && closing.box}
      {canDelete && (
        <Button
          variant="ghost"
          className="text-red-700"
          data-howto="run-delete"
          disabled={busy}
          onClick={() => {
            if (!confirm("Delete this run and all its results? This can't be undone.")) return;
            start(async () => {
              await deleteRun(projectId, runId);
              router.push(`/p/${projectKey}/runs`);
            });
          }}
        >
          Delete
        </Button>
      )}
    </>
  );
}

/** Close a run from the run page, the Overview and the last case in the runner; asks first if cases are untested. */
export function CloseRunButton({
  projectId,
  runId,
  variant = "primary",
  label = "Close run",
  onClosed,
}: {
  projectId: string;
  runId: string;
  variant?: "primary" | "secondary";
  label?: string;
  onClosed?: () => void;
}) {
  const closing = useCloseRun(projectId, runId, onClosed);
  return (
    <>
      <Button size="sm" variant={variant} disabled={closing.pending} onClick={closing.click} data-howto="run-close">
        {closing.pending ? "Closing…" : label}
      </Button>
      {closing.box}
    </>
  );
}
