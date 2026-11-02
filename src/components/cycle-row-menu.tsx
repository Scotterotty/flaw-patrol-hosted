"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cycleHash } from "@/lib/cycle-hash";
import { setKeepCurrent } from "@/server/umbrella";
import { useAction } from "./umbrella-action";
import { Button, ErrorText } from "./ui";

const ITEM = "block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100";

/** ⋯ on a Test cycles row: 📌 Keep in Current, Settings, Archive…. Only for people who may archive the test cycle. */
export function CycleRowMenu({ groupId, cycle }: { groupId: string; cycle: { id: string; key: string; name: string; keepCurrent: boolean; archived: boolean } }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const { pending, error, setError, run } = useAction();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={box} className="relative inline-block">
      <Button size="sm" aria-haspopup="menu" aria-expanded={open} aria-label={`More for ${cycle.name}`} onClick={() => setOpen((o) => !o)}>
        ⋯
      </Button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-surface p-1 text-left shadow-lg">
          {!cycle.archived && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={cycle.keepCurrent}
              disabled={pending}
              className={ITEM}
              onClick={() => {
                setOpen(false);
                run(() => setKeepCurrent(cycle.id, !cycle.keepCurrent));
              }}
            >
              <span aria-hidden>📌</span> Keep in Current{cycle.keepCurrent && <span aria-hidden> ✓</span>}
            </button>
          )}
          <Link role="menuitem" href={`/g/${groupId}/settings#${cycleHash(cycle.key)}`} className={ITEM}>
            Settings
          </Link>
          {!cycle.archived && (
            <Link role="menuitem" href={`/g/${groupId}/settings?archive=${cycle.id}#archive`} className={ITEM}>
              Archive…
            </Link>
          )}
        </div>
      )}
      {error && (
        <span className="absolute top-full right-0 z-30 mt-1 w-64">
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        </span>
      )}
    </span>
  );
}
