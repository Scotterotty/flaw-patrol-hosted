"use client";

import { useState } from "react";
import { cx } from "./ui";

/** This build's version, set in next.config.ts from package.json. */
export const CLIENT_VERSION = process.env.APP_VERSION ?? "";

/**
 * "Version 0.3.0-alpha.122" in small gray text: under Arrange menu order and at the
 * bottom of the name menu. Clicking copies the number for a bug report.
 */
export function VersionLine({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!CLIENT_VERSION) return null;
  return (
    <button
      type="button"
      data-testid="version-line"
      title="Copy the version number, for a bug report"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(CLIENT_VERSION).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      className={cx("flex w-full items-center gap-1 rounded-md px-2.5 py-0.5 text-left text-[11px] text-slate-400 select-text hover:bg-slate-100 hover:text-slate-600", className)}
    >
      {copied ? "Copied" : "Version"} <span className="font-mono">{CLIENT_VERSION}</span>
    </button>
  );
}
