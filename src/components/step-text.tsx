"use client";

import { useState } from "react";
import { stepPieces } from "@/lib/step-pieces";
import { TermParts, useTermParts } from "./glossary";
import { cx } from "./ui";

/** Test data values picked out in blue, so it's clear what changes from row to row. */
function TestValue({ text }: { text: string }) {
  return (
    <span data-test-value className="rounded bg-blue-50 px-0.5 font-medium text-blue-800 ring-1 ring-blue-100 ring-inset">
      {text}
    </span>
  );
}

/** Step text with its web addresses as links (each with a one-click Copy), test data values and Glossary terms. */
export function StepText({ text, className, marks }: { text: string; className?: string; marks?: string[] }) {
  const pieces = stepPieces(text, marks);
  // Glossary terms are underlined once per step, in the plain text only: never in links or test data values.
  const terms = useTermParts(pieces.map((p) => (p.kind === "text" ? p.text : "")));
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.kind === "link" ? (
          <span key={i} className="inline">
            <a href={p.text} target="_blank" rel="noreferrer" className="break-all text-accent-700 underline decoration-accent-300 hover:decoration-accent-700" onClick={(e) => e.stopPropagation()}>
              {p.text}
            </a>
            <CopyButton value={p.text} />
          </span>
        ) : p.kind === "value" ? (
          <TestValue key={i} text={p.text} />
        ) : (
          <span key={i}>{terms ? <TermParts parts={terms[i]} /> : p.text}</span>
        ),
      )}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy link"
      aria-label={`Copy ${value}`}
      className={cx(
        "ml-1 inline-flex h-5 items-center rounded px-1.5 align-text-bottom text-[11px] font-medium ring-1 ring-inset select-none",
        copied ? "bg-green-50 text-green-800 ring-green-200" : "bg-surface text-slate-500 ring-slate-200 hover:text-slate-800",
      )}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
