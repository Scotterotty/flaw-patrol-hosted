"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteRun, setRunState } from "@/server/runs";
import { Button } from "./ui";

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
  return (
    <>
      {canClose && (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              await setRunState(projectId, runId, state === "ACTIVE" ? "COMPLETED" : "ACTIVE");
              router.refresh();
            })
          }
        >
          {state === "ACTIVE" ? "Close run" : "Reopen run"}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          className="text-red-700"
          disabled={pending}
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

/** Close a finished run in one click, from the run page, the Overview and the last case in the runner. */
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
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setRunState(projectId, runId, "COMPLETED");
          onClosed?.();
          router.refresh();
        })
      }
    >
      {pending ? "Closing…" : label}
    </Button>
  );
}
