"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removePracticeRun, startPracticeRun } from "@/server/practice";
import { Button, ErrorText } from "./ui";

/** On every page of a practice run (ver_217): whose it is, what to try, and the way out. */
export function PracticeBanner({ tested, total }: { tested: number; total: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = total > 0 && tested >= total;
  const remove = () =>
    start(async () => {
      const res = await removePracticeRun();
      if (!res.ok) return setError(res.error);
      router.push("/start");
      router.refresh();
    });
  return (
    <section aria-label="Practice run" data-testid="practice-banner" data-howto="practice-banner" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p>
        <span className="mr-2 rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-amber-950">PRACTICE</span>
        <span className="font-semibold">Only you see this.</span> It isn&apos;t in reports, Jira or Slack.
      </p>
      <p className="mt-1">
        {done
          ? `✓ All ${total} sample cases tested. That's the whole loop: mark steps, save, report a bug.`
          : "Pass what works. In “Sign in with a sample account”, step 2 is meant to fail: mark it Failed and report it as a bug to see how."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" onClick={remove} disabled={pending} data-testid="practice-remove">
          {pending ? "Removing…" : "Remove practice run"}
        </Button>
        <span className="text-xs text-amber-900">It also goes away on its own after 7 days.</span>
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </section>
  );
}

/** "New here? Try a 2-minute practice run" at the top of Start here (ver_217). */
export function PracticeOffer({ resume }: { resume: { href: string; tested: number; total: number } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = () =>
    start(async () => {
      const res = await startPracticeRun();
      if (!res.ok) return setError(res.error);
      router.push(res.href);
    });
  return (
    <div className="mb-3 rounded-md border border-accent-200 bg-accent-50 px-3 py-2.5" data-testid="practice-offer" data-howto="practice-offer">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-slate-800">
          <span className="font-semibold">{resume ? "Your practice run" : "New here? Try a 2-minute practice run"}</span>
          <span className="block text-xs text-slate-600">
            {resume ? `${resume.tested} of ${resume.total} sample cases tested. Only you see it.` : "3 sample cases. Only you see it. Not in reports."}
          </span>
        </p>
        {resume ? (
          <Button size="sm" variant="primary" onClick={() => router.push(resume.href)} data-testid="practice-try">
            Continue
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={go} disabled={pending} data-testid="practice-try">
            {pending ? "Setting up…" : "Try it"}
          </Button>
        )}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
    </div>
  );
}
