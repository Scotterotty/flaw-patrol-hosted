import type { BuildSteps, StepState } from "@/lib/github-steps";
import { cx } from "./ui";

// GitHub build steps: ✓ passed, ✕ failed, ○ didn't run. Shown in Pull from GitHub,
// on a pulled run's page and on the Repositories page.

const MARK: Record<StepState, { icon: string; cls: string; tip: string }> = {
  pass: { icon: "✓", cls: "text-emerald-800", tip: "passed" },
  fail: { icon: "✕", cls: "font-semibold text-red-700", tip: "failed" },
  skip: { icon: "○", cls: "text-slate-500", tip: "didn't run, because an earlier step failed" },
  running: { icon: "…", cls: "text-slate-500", tip: "still running" },
};

/** The key shown once above a list of runs. */
export function StepKey() {
  return (
    <span className="text-xs text-slate-500">
      Steps: <span className="text-emerald-800">✓ passed</span> · <span className="text-red-700">✕ failed</span> · ○ didn&apos;t run
    </span>
  );
}

/** Each job's steps in order: "✓ Install › ✕ Build › ○ Run tests". A job name leads only when there are several jobs. */
export function StepChips({ steps, note, className }: { steps: BuildSteps; note?: (name: string) => string | null; className?: string }) {
  const many = steps.jobs.length > 1;
  return (
    <span className={cx("flex flex-col gap-0.5", className)}>
      {steps.jobs.map((j, ji) => (
        <span key={ji} className="flex flex-wrap items-center gap-x-1 text-xs" data-testid="build-steps">
          {many && <span className="mr-1 font-medium text-slate-700">{j.name}:</span>}
          {j.steps.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && (
                <span aria-hidden className="text-slate-400">
                  ›
                </span>
              )}
              <span className={MARK[s.state].cls} title={`${s.name} ${MARK[s.state].tip}`}>
                {MARK[s.state].icon} {s.name}
                {note?.(s.name) && <span className="font-normal text-slate-600"> · {note(s.name)}</span>}
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/** The plain sentence, GitHub's error line and the log link, when something broke. */
export function StepProblem({ steps, className }: { steps: BuildSteps; className?: string }) {
  if (!steps.sentence) return null;
  return (
    <p className={cx("text-xs", steps.buildBroke ? "text-red-800" : "text-slate-600", className)}>
      {steps.sentence}
      {steps.message ? (
        <>
          : <span className="font-mono">{steps.message}</span>
        </>
      ) : (
        "."
      )}{" "}
      {steps.logUrl && (
        <a href={steps.logUrl} target="_blank" rel="noreferrer" className="font-medium text-accent-700 hover:underline">
          Open log on GitHub ↗
        </a>
      )}
    </p>
  );
}
