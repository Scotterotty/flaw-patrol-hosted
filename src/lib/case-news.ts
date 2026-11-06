import { diffLists } from "./diff";

// New and Updated cases in a run: pure helpers, shared by the server and the runner.

/** How one step of the case differs from the copy its last run used. */
export type StepChange = { kind: "new" } | { kind: "reworded"; action: string; expected: string };

export type CaseNews =
  | { kind: "new"; addedBy: string; addedAt: string }
  | {
      kind: "updated";
      /** The last earlier run that had the case. */
      since: { run: number; label: string; at: string; version: number };
      by: string;
      at: string;
      /** "Step 3 reworded, step 5 added". */
      what: string;
      /** By this run's step index. */
      steps: Record<number, StepChange>;
      removed: number;
      /** The old preconditions, when they changed. */
      preconditions: string | null;
      version: number;
    };

type Step = { action: string; expected?: string; number?: string };
const keyOf = (s: Step) => `${s.action.trim()}\u0000${(s.expected ?? "").trim()}`;

/** Which steps are new or reworded, pairing a removed step with the added one in its place. */
export function stepChanges(before: Step[], after: Step[]) {
  const ops = diffLists(before, after, keyOf);
  const steps: Record<number, StepChange> = {};
  let j = 0;
  let removed = 0;
  let pending: Step[] = [];
  for (const op of ops) {
    if (op.op === "removed") {
      pending.push(op.value);
      continue;
    }
    if (op.op === "added") {
      const old = pending.shift();
      steps[j] = old ? { kind: "reworded", action: old.action, expected: old.expected ?? "" } : { kind: "new" };
    } else {
      removed += pending.length;
      pending = [];
    }
    j++;
  }
  removed += pending.length;
  return { steps, removed };
}

/** "Step 3 reworded, step 5 added, preconditions updated". */
export function changeSummary(after: Step[], steps: Record<number, StepChange>, removed: number, preconditions: boolean) {
  const label = (i: number) => after[i]?.number ?? String(i + 1);
  const list = (kind: StepChange["kind"]) => Object.keys(steps).map(Number).filter((i) => steps[i].kind === kind).map(label);
  const words = (nums: string[], verb: string) => (nums.length ? `${nums.length === 1 ? "step" : "steps"} ${nums.join(", ")} ${verb}` : "");
  const bits = [
    words(list("reworded"), "reworded"),
    words(list("new"), "added"),
    removed ? `${removed} ${removed === 1 ? "step" : "steps"} removed` : "",
    preconditions ? "preconditions updated" : "",
  ].filter(Boolean);
  const text = bits.join(", ") || "steps updated";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const newsCount = (list: (CaseNews | undefined)[]) => ({
  new: list.filter((n) => n?.kind === "new").length,
  updated: list.filter((n) => n?.kind === "updated").length,
});

/** "3 new cases and 2 updated". */
export function newsLine(c: { new: number; updated: number }) {
  return [c.new && `${c.new} new ${c.new === 1 ? "case" : "cases"}`, c.updated && `${c.updated} updated`].filter(Boolean).join(" and ");
}
