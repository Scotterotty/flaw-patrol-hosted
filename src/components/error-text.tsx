"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A red error message with an × to close it. It comes back when the message
 * changes, or (with onDismiss clearing it) the next time the error happens.
 */
export function ErrorText({ children, onDismiss }: { children?: ReactNode; onDismiss?: () => void }) {
  const [closed, setClosed] = useState(false);
  const text = typeof children === "string" ? children : null;
  useEffect(() => setClosed(false), [text]);
  if (!children || closed) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <span className="min-w-0 flex-1">{children}</span>
      <button
        type="button"
        aria-label="Close message"
        title="Close"
        onClick={() => {
          setClosed(true);
          onDismiss?.();
        }}
        className="-my-0.5 -mr-1 shrink-0 rounded px-1.5 text-base leading-none text-red-500 hover:bg-red-100 hover:text-red-800"
      >
        ×
      </button>
    </p>
  );
}
