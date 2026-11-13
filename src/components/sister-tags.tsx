import type { Disagree, FillMark } from "@/lib/sisters";
import { STATUS_LABEL } from "@/lib/status";

// Sister cases in the RC runner: which steps the dry run filled in, and dry run results that
// didn't match a step that already had one.

const time = (at: string) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "✓ From dry run · Sam · 8:52 PM" on a step the dry run filled. */
export function SisterStepTag({ mark }: { mark: FillMark }) {
  const word = STATUS_LABEL[mark.status] ?? mark.status;
  return (
    <span className="mb-1 block text-xs font-medium text-emerald-800 select-none" title={`${word} in the dry run: ${mark.from} (${mark.run})`} data-testid="sister-tag">
      <span aria-hidden>{mark.status === "PASSED" ? "✓" : mark.status === "FAILED" ? "✕" : "!"}</span> From dry run · {mark.by} · <time dateTime={mark.at}>{time(mark.at)}</time>
      {mark.status !== "PASSED" && <span className="text-red-800"> · {word}</span>}
      {mark.bugs.length > 0 && <span> · bug {mark.bugs.join(", ")}</span>}
    </span>
  );
}

/** A yellow note when the dry run said something different from what a step already has. */
export function SisterDisagreeNote({ list, numberOf }: { list: Disagree[]; numberOf: (i: number) => string }) {
  if (!list.length) return null;
  return (
    <div role="note" className="mb-3 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="sister-disagree">
      {list.map((d) => (
        <p key={d.from + d.at}>
          The dry run says <strong>{STATUS_LABEL[d.says] ?? d.says}</strong> for step {d.steps.map(numberOf).join(", ")} ({d.from}, {d.by}). The step already had a different result, so it wasn&apos;t changed.
        </p>
      ))}
    </div>
  );
}
