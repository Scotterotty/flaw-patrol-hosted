"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function useAction(after?: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(
    fn: () => Promise<({ ok: true } & T) | { ok: false; error: string }>,
    /** Returns true when it goes to another page itself, so this page isn't reloaded first. */
    done?: (r: T) => void | boolean,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      setError(null);
      if (done?.(r) !== true) {
        router.refresh();
        after?.();
      }
    });
  return { pending, error, setError, run, router };
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
