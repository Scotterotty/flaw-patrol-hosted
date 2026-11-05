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
  resume,
}: {
  /** A half-done session you came back to (ver_54 audit #1): said in this bar, not a second banner. */
  resume?: { text: string; onResume?: () => void } | null;
  /** An exploratory session has notes, not steps. */
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
  if (closed && !assignee && !resume) return null;

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
          <span>{session ? (resume ? "You're exploring this." : "You're exploring this, so teammates see it's taken.") : "You're testing this case, so teammates see it's taken."}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <PersonLabel person={assignee} size={18} />
            <span>is on this {session ? "session" : "case"}.</span>
          </span>
        )
      ) : resume ? null : (
        <span>{closed ? "Nobody took this case." : session ? "Write a note to start exploring. Your teammates will see you're on this session." : "Mark a step to start testing. Your teammates will see you're on this case."}</span>
      )}
      {resume && <span data-testid="resume-note">{resume.text}</span>}
      {!closed && resume?.onResume && (
        <Button size="sm" variant="primary" onClick={resume.onResume} className="ml-auto">
          Keep exploring
        </Button>
      )}
      {!closed && assignee && !mine && (
        <Button size="sm" disabled={pending} onClick={() => act(true, true)} className="ml-auto" data-howto="take-over">
          Take it over
        </Button>
      )}
      {!closed && mine && (
        <Button size="sm" disabled={pending} onClick={() => act(false)} className={resume?.onResume ? undefined : "ml-auto"} data-howto="stop-testing">
          Stop testing
        </Button>
      )}
      {!closed && mine && (
        <p className="w-full text-xs text-slate-500" data-testid="stop-testing-help">
          {session ? (
            <>
              <b>Stop testing</b> frees this session so someone else can pick it up. Your notes are kept, and you can come back to it.
            </>
          ) : (
            <>
              <b>Stop testing</b> frees this case so someone else can test it. Your marks so far are kept, and you can come back and pick it up again.
            </>
          )}
        </p>
      )}
      {error && <div className="w-full text-xs"><ErrorText onDismiss={() => setError(null)}>{error}</ErrorText></div>}
    </div>
  );
}
