"use client";

import type { ReactNode } from "react";
import { openHowTo } from "./how-to-guide";

/** A text button that opens the How-to guide, on a task when one is named (ver_178). */
export function HowToLink({ task, className, children, testId }: { task?: string; className?: string; children: ReactNode; testId?: string }) {
  return (
    <button type="button" className={className} onClick={() => openHowTo(task)} data-testid={testId ?? "open-how-to"}>
      {children}
    </button>
  );
}
