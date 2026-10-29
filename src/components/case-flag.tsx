"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FLAG_REASONS, flagLabel, type CaseFlagInfo, type FlagReason } from "@/lib/case-flag";
import { clearCaseFlag, flagCase } from "@/server/case-flag";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Textarea } from "./ui";

/** A little pennant. Filled when the case is flagged. */
export function FlagIcon({ filled = true, className }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cx("size-4 shrink-0", className)} aria-hidden>
      <path d="M3.5 1.5v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path
        d="M4 2.2c2.6-1.3 4.4 1.3 7.6.2.4-.1.8.2.8.6v5.4c0 .3-.2.5-.4.6-3.2 1.2-5.1-1.4-8 0z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The flag shown next to a case in lists, with the reason on hover. */
export function FlagMark({ flag }: { flag: CaseFlagInfo }) {
  const why = `${flagLabel(flag.reason)}${flag.note ? `: ${flag.note}` : ""} (flagged by ${flag.by} ${flag.ago})`;
  return (
    <span title={why} aria-label={`Flagged: ${flagLabel(flag.reason)}`} role="img" className="inline-flex text-orange-500">
      <FlagIcon />
    </span>
  );
}

/**
 * Flag a case for attention (it needs updating, its steps are unclear…), or
 * see and clear the flag. Used in the runner and on the case page.
 */
export function CaseFlagButton({
  projectId,
  projectKey,
  caseId,
  flag,
  runNumber = null,
  size = "md",
}: {
  projectId: string;
  projectKey: string;
  caseId: string;
  flag: CaseFlagInfo | null;
  runNumber?: number | null;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<FlagReason>(flag?.reason ?? "NEEDS_UPDATE");
  const [note, setNote] = useState(flag?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const showForm = !flag || editing;

  const run = (fn: () => ReturnType<typeof clearCaseFlag>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setError(null);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setEditing(false);
          setReason(flag?.reason ?? "NEEDS_UPDATE");
          setNote(flag?.note ?? "");
          setError(null);
        }}
        title={flag ? `${flagLabel(flag.reason)}${flag.note ? `: ${flag.note}` : ""}` : "Flag this case if it needs updating or other attention"}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset select-none",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
          flag ? "bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100" : "text-slate-500 ring-slate-200 hover:bg-slate-100 hover:text-slate-800",
        )}
      >
        <FlagIcon filled={!!flag} className={size === "sm" ? "size-3.5" : undefined} />
        {flag ? flagLabel(flag.reason) : "Flag"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={showForm ? "Flag this case" : "Flagged case"}>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        {showForm ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => flagCase(projectId, caseId, { reason, note, runNumber }));
            }}
          >
            <p className="text-sm text-slate-600">Flagged cases show a flag in Test cases, so whoever looks after them can find what needs fixing.</p>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Reason</legend>
              {(Object.keys(FLAG_REASONS) as FlagReason[]).map((r) => (
                <label
                  key={r}
                  className={cx(
                    "cursor-pointer rounded-full px-3 py-1 text-sm ring-1 ring-inset",
                    reason === r ? "bg-orange-50 text-orange-800 ring-orange-300" : "text-slate-600 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  <input type="radio" name="flag-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="sr-only" />
                  {r === "OTHER" ? "Something else" : FLAG_REASONS[r]}
                </label>
              ))}
            </fieldset>
            <Field label="Note (optional)" htmlFor="flag-note">
              <Textarea id="flag-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Step 4 points at the old settings page" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => (flag ? setEditing(false) : setOpen(false))}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                <FlagIcon className="size-3.5" />
                {flag ? "Update flag" : "Flag case"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-orange-700">
              <FlagIcon /> {flagLabel(flag.reason)}
            </p>
            {flag.note && <p className="whitespace-pre-wrap wrap-anywhere text-slate-700">{flag.note}</p>}
            <p className="text-xs text-slate-500">
              Flagged by {flag.by} {flag.ago}
              {flag.runNumber && (
                <>
                  {" "}
                  in{" "}
                  <Link href={`/p/${projectKey}/runs/${flag.runNumber}`} className="hover:underline">
                    run R{flag.runNumber}
                  </Link>
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditing(true)}>Edit</Button>
              <Button variant="primary" disabled={pending} onClick={() => run(() => clearCaseFlag(projectId, caseId))}>
                Clear flag
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
