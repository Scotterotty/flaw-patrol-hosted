"use client";

import type { Severity } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateDefect } from "@/server/defects";
import { refreshFromJira, refreshFromJiraMany } from "@/server/jira";
import { BugDialog } from "./bug-dialog";
import { Button, Select } from "./ui";

export function RefreshJiraButton({ projectId, projectIds }: { projectId: string; projectIds?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = projectIds ? await refreshFromJiraMany(projectIds) : await refreshFromJira(projectId);
            setMsg(res.ok ? `Updated ${res.refreshed} from Jira${res.failed.length ? `. Couldn’t read ${res.failed.join("; ")}` : ""}` : res.error);
            router.refresh();
          })
        }
      >
        {pending ? "Refreshing…" : "Refresh from Jira"}
      </Button>
    </span>
  );
}

type Local = { id: string; title: string; description: string; severity: Severity; status: "OPEN" | "FIXED" | "CLOSED" | "WONT_FIX" };

export function LocalDefectStatus({ projectId, defect }: { projectId: string; defect: Local }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Bug status"
      className="h-7 w-28 text-xs"
      value={defect.status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await updateDefect(projectId, defect.id, { ...defect, status: e.target.value as Local["status"] });
          router.refresh();
        })
      }
    >
      <option value="OPEN">Open</option>
      <option value="FIXED">Fixed</option>
      <option value="CLOSED">Closed</option>
      <option value="WONT_FIX">Won&apos;t fix</option>
    </Select>
  );
}

export type SendToJiraData = {
  projectId: string;
  defect: { id: string; label: string; title: string; severity: Severity };
  entryId: string;
  stepIndex: number | null;
  actual: string;
  attachments: { id: string; fileName: string; contentType: string; label: string }[];
};

/**
 * Send to Jira (ver_91): a bug saved before Jira was connected opens the usual bug box,
 * filled in from the result it came from, and becomes that Jira issue.
 */
export function SendToJiraButton({ data }: { data: SendToJiraData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Send to Jira
      </Button>
      {open && (
        <BugDialog
          open
          onClose={() => setOpen(false)}
          onLinked={() => router.refresh()}
          projectId={data.projectId}
          entryId={data.entryId}
          stepIndex={data.stepIndex}
          stepLabel={data.stepIndex === null ? "whole case" : `step ${data.stepIndex + 1}`}
          actual={data.actual}
          attachments={data.attachments}
          jiraConnected
          recent={[]}
          fromDefect={data.defect}
        />
      )}
    </>
  );
}
