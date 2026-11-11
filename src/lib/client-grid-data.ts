import type { ResultStatus } from "@prisma/client";
import type { GridBug, GridEntry } from "@/components/client-grid";
import { parseDraft } from "./run-draft";
import { resultSteps } from "./result-steps";
import { headingRows, withoutHeadings } from "./step-checks";
import { stepsToRun, type ExpandedStep } from "./steps";
import { parseTestData } from "./test-data";

// Clients (ver_214): one run entry as the run page's client grid shows it.

type EntryBits = {
  id: string;
  title: string;
  folderPath: string;
  status: ResultStatus;
  steps: unknown;
  testData: unknown;
  clients: string[];
  draft: unknown;
  results: { stepResults: unknown }[];
};
type Link = { stepIndex: number | null; result: { entryId: string }; defect: { externalKey: string | null; externalUrl: string | null; number: number; id: string } };

/** The step a client runs, in full: its Step and Expected, one step after another. */
export function stepTextOf(steps: ExpandedStep[], title: string): string {
  const first = steps.filter((s) => s.row === steps[0]?.row);
  const lines = (s: ExpandedStep) => [s.action.trim() && s.action.trim() !== title.trim() ? s.action.trim() : "", s.expected.trim()].filter(Boolean).join("\n");
  if (first.length <= 1) return first[0] ? lines(first[0]) : "";
  return first.map((s) => `${s.number ? `${s.number}. ` : ""}${lines(s)}`).join("\n");
}

export function clientGridEntry(e: EntryBits, caseKey: string, links: Link[]): GridEntry {
  const raw = (Array.isArray(e.steps) ? e.steps : []) as ExpandedStep[];
  const headings = headingRows(raw);
  const data = parseTestData(e.testData);
  const rowOf = raw.flatMap((s, i) => (headings.has(i) ? [] : [s.row ?? 0]));
  const rowClient = data?.rows.map((r) => r[0] ?? "") ?? [];
  const draft = e.status === "IN_PROGRESS" ? parseDraft(e.draft) : null;
  const saved = e.status !== "IN_PROGRESS" && e.status !== "UNTESTED" ? e.results[0] : undefined;
  const progress = draft ? withoutHeadings(raw, draft.stepResults).map((s) => s.status as ResultStatus) : saved ? resultSteps(saved.stepResults, raw) : null;
  // Bugs: the ones filed on a client's steps in this run, plus any waiting in the autosaved draft.
  const bugs: Record<string, GridBug[]> = {};
  const add = (stepIndex: number | null, b: { externalKey: string | null; externalUrl: string | null; number: number }) => {
    if (stepIndex === null) return;
    const row = raw[stepIndex]?.row;
    const client = row === undefined ? null : rowClient[row];
    if (!client) return;
    const key = b.externalKey ?? `D-${b.number}`;
    const list = (bugs[client] ??= []);
    if (!list.some((x) => x.key === key)) list.push({ key, url: b.externalUrl });
  };
  for (const l of links) if (l.result.entryId === e.id) add(l.stepIndex, l.defect);
  for (const d of draft?.defects ?? []) add(d.stepIndex, d.defect);
  return {
    id: e.id,
    caseKey,
    title: e.title,
    group: e.folderPath.split(" / ")[0] || "",
    stepText: stepTextOf(stepsToRun(raw, e.title), e.title),
    clients: e.clients,
    rowOf,
    rowClient,
    progress,
    bugs,
  };
}
