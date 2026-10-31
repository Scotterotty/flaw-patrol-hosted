"use client";

import { useState } from "react";
import { TermParts, useTermParts } from "./glossary";
import { cx } from "./ui";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Step text with its web addresses as links, each with a one-click Copy. */
export function StepText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  // Glossary terms (ver_113) are underlined once per step, links never.
  const terms = useTermParts(parts.map((p, i) => (i % 2 === 1 ? "" : p)));
  return (
    <span className={className}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="inline">
            <a href={part} target="_blank" rel="noreferrer" className="break-all text-accent-700 underline decoration-accent-300 hover:decoration-accent-700" onClick={(e) => e.stopPropagation()}>
              {part}
            </a>
            <CopyButton value={part} />
          </span>
        ) : (
          <span key={i}>{terms ? <TermParts parts={terms[i]} /> : part}</span>
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
