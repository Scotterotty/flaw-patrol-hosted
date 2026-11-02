// GitHub build steps: which of a workflow run's own steps passed, failed or
// didn't run, and one plain sentence saying what happened. Pure, so it's unit tested.

export type StepState = "pass" | "fail" | "skip" | "running";
export type BuildStep = { name: string; state: StepState };
export type BuildJob = { name: string; url: string; steps: BuildStep[] };
export type BuildSteps = {
  jobs: BuildJob[];
  /** "Some tests failed", "Build failed, so no tests ran"… null when nothing failed. */
  sentence: string | null;
  /** GitHub's own error line for the step that broke, when it gave one. */
  message: string | null;
  /** Where to read the log of the job that broke. */
  logUrl: string | null;
  /** A step other than the tests failed, so it isn't the tests' fault. */
  buildBroke: boolean;
  /** Tests never ran because an earlier step failed. */
  noTests: boolean;
};

export type RawJob = { name: string; html_url: string; conclusion: string | null; status?: string; steps?: { name: string; number?: number; conclusion: string | null; status?: string }[] };

// GitHub's own housekeeping steps, and the step that saves the results file.
const HIDDEN = [/^set up job$/i, /^complete job$/i, /^post /i, /^run actions\/(checkout|setup-[\w-]+|cache|upload-artifact|download-artifact)@/i, /^(checkout|check out)( code| repo(sitory)?)?$/i, /^set ?up (node|python|java|go|\.net)/i, /^(upload|save|keep) (the )?(test )?(results|artifact)/i];

export const isHiddenStep = (name: string) => HIDDEN.some((r) => r.test(name.trim()));
const isTestStep = (name: string) => /\btests?\b|\bspec(s)?\b|jest|pytest|vitest|playwright|cypress/i.test(name);

function stateOf(s: { conclusion: string | null; status?: string }): StepState {
  if (s.conclusion === "success") return "pass";
  if (s.conclusion === "failure" || s.conclusion === "timed_out") return "fail";
  if (!s.conclusion && s.status && s.status !== "completed") return "running";
  return "skip";
}

/** Step names come live from GitHub; unnamed steps already arrive as their command ("Run npm ci"). */
export function buildSteps(jobs: RawJob[], annotation: (jobIndex: number) => string | null = () => null): BuildSteps {
  const out: BuildJob[] = jobs.map((j) => ({ name: j.name, url: j.html_url, steps: (j.steps ?? []).filter((s) => !isHiddenStep(s.name)).map((s) => ({ name: s.name, state: stateOf(s) })) }));
  const all = out.flatMap((j) => j.steps);
  const failed = all.filter((s) => s.state === "fail");
  const tests = all.filter((s) => isTestStep(s.name));
  const testsFailed = tests.some((s) => s.state === "fail");
  const testsRan = tests.some((s) => s.state === "pass" || s.state === "fail");
  const others = failed.filter((s) => !isTestStep(s.name));
  const noTests = tests.length > 0 && !testsRan && others.length > 0;
  let sentence: string | null = null;
  if (noTests) sentence = `${others[0].name} failed, so no tests ran`;
  else if (testsFailed && others.length) sentence = `Some tests failed, and ${others.map((s) => s.name).join(" and ")} also failed`;
  else if (testsFailed) sentence = "Some tests failed";
  else if (others.length) sentence = `${others.map((s) => s.name).join(" and ")} failed${testsRan ? ", after the tests ran" : ""}`;
  else if (!all.length && jobs.some((j) => j.conclusion === "failure")) sentence = "The run failed";
  // The message and log belong to the job with the step that matters most: a non-test failure first.
  const key = others[0] ?? failed[0];
  const jobIndex = key ? out.findIndex((j) => j.steps.includes(key)) : jobs.findIndex((j) => j.conclusion === "failure");
  return {
    jobs: out,
    sentence,
    message: jobIndex >= 0 ? annotation(jobIndex) : null,
    logUrl: jobIndex >= 0 ? out[jobIndex].url : null,
    buildBroke: others.length > 0,
    noTests,
  };
}

/** GitHub's annotation for a failed job, minus the generic "Process completed with exit code 1". */
export function pickAnnotation(list: { message?: string; annotation_level?: string }[]) {
  const real = list.filter((a) => a.annotation_level !== "notice" && a.message && !/^Process completed with exit code \d+\.?$/i.test(a.message.trim()));
  return real[0]?.message?.split("\n")[0].trim() ?? null;
}
