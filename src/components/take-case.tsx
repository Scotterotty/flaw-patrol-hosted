"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { takeEntry } from "@/server/runs";
import { PersonLabel, type AvatarPerson } from "./avatar";
import { Button, cx, ErrorText } from "./ui";

/** Who's on this case. Marking a step takes it, so there's only a button to take it over from someone else. */
export function TakeCase({
  projectId,
  entryId,
  assignee,
  me,
  closed,
  session,
}: {
  /** An exploratory session has notes, not steps (ver_89). */
  session?: boolean;
  projectId: string;
  entryId: string;
  assignee: AvatarPerson | null;
  me: string;
  closed: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = assignee?.id === me;
  if (closed && !assignee) return null;

  const act = (take: boolean, over = false) =>
    start(async () => {
      const res = await takeEntry(projectId, entryId, take, over);
      setError(res.ok ? null : res.error);
      router.refresh();
    });

  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        assignee && !mine ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-surface text-slate-600",
      )}
    >
      {assignee ? (
        mine ? (
          <span>You&apos;re testing this case, so teammates see it&apos;s taken.</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <PersonLabel person={assignee} size={18} />
            <span>is on this case.</span>
          </span>
        )
      ) : (
        <span>{closed ? "Nobody took this case." : session ? "Write a note to start exploring. Your teammates will see you're on this session." : "Mark a step to start testing. Your teammates will see you're on this case."}</span>
      )}
      {!closed && assignee && !mine && (
        <Button size="sm" disabled={pending} onClick={() => act(true, true)} className="ml-auto">
          Take it over
        </Button>
      )}
      {!closed && mine && (
        <Button size="sm" disabled={pending} onClick={() => act(false)} className="ml-auto">
          Stop testing
        </Button>
      )}
      {!closed && mine && (
        <p className="w-full text-xs text-slate-500" data-testid="stop-testing-help">
          <b>Stop testing</b> frees this case so someone else can test it. Your marks so far are kept, and you can come back and pick it up again.
        </p>
      )}
      {error && <div className="w-full text-xs"><ErrorText onDismiss={() => setError(null)}>{error}</ErrorText></div>}
    </div>
  );
}
