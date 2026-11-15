"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { relativeTime } from "@/lib/format";
import { fewNames } from "@/lib/link-access";
import { startPracticeRun } from "@/server/practice";
import { askToBeAdded, cancelAskToBeAdded } from "@/server/workspace-join";
import { Button, ErrorText } from "./ui";

// No umbrella yet (ver_259): the welcome page's Join your team button and practice run link.

/** Ask to be added, then "Sent to Scott and Katie" with Cancel request. */
export function AskToBeAdded({ admins, askedAt }: { admins: string[]; askedAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? "That didn't work. Try again."));
      router.refresh();
    });
  const who = admins.length ? fewNames(admins) : "Your admins";
  return (
    <div className="mt-auto space-y-2 pt-1">
      {askedAt ? (
        <div role="status" data-testid="asked-to-be-added" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <span suppressHydrationWarning>
            Sent to {who} {relativeTime(new Date(askedAt))}.
          </span>{" "}
          This page opens your umbrella as soon as {admins.length === 1 ? "they add" : "one of them adds"} you.{" "}
          <button type="button" disabled={pending} onClick={() => act(cancelAskToBeAdded)} className="font-medium underline">
            Cancel request
          </button>
        </div>
      ) : (
        <Button variant="primary" disabled={pending} onClick={() => act(askToBeAdded)} data-howto="ask-to-be-added">
          {pending ? "Asking…" : "Ask to be added"}
        </Button>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}

/** Try a 2-minute practice run (or Continue your practice run), without an umbrella. */
export function WelcomePractice({ resume }: { resume: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      if (resume) return router.push(resume);
      const r = await startPracticeRun();
      if (!r.ok) return setError(r.error);
      router.push(r.href);
    });
  return (
    <>
      <button type="button" onClick={go} disabled={pending} data-howto="welcome-practice" className="font-medium text-accent-700 underline underline-offset-2 hover:text-accent-600">
        {pending ? "Setting up…" : resume ? "Continue your practice run" : "Try a 2-minute practice run"}
      </button>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </>
  );
}
