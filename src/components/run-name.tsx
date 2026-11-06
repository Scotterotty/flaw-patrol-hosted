import { runTag, type RunLike } from "@/lib/run-label";
import type { Spelling } from "@/lib/spelling";

/** A run's name with its version after it, quieter (ver_189: in place of "R1"). */
export function RunName({ run, spelling = "us", zone, className }: { run: RunLike; spelling?: Spelling; zone?: string; className?: string }) {
  const tag = runTag(run, spelling, zone);
  return (
    <>
      {run.name}
      {tag && (
        <>
          {" "}
          <span className={className ?? "font-mono text-xs text-slate-500"} data-testid="run-version">
            {tag}
          </span>
        </>
      )}
    </>
  );
}
