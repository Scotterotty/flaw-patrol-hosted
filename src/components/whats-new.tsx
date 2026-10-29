"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { WhatsNewEntry, WhatsNewItem } from "@/content/whats-new";
import { shortDate } from "@/lib/whats-new";
import { markWhatsNewSeen } from "@/server/whats-new";
import { useSpelling } from "./spelling";
import { Badge, Button, InfoTip, type Tone } from "./ui";

const TAG: Record<WhatsNewItem["kind"], { label: string; tone: Tone }> = {
  new: { label: "New", tone: "green" },
  better: { label: "Better", tone: "blue" },
  fix: { label: "Fixed", tone: "orange" },
};

/** One change: its tag, a one-line title, a short note and, when it has a place to go, Show me. */
export function WhatsNewLine({ i, showMe, onGo }: { i: WhatsNewItem; showMe?: boolean; onGo?: () => void }) {
  return (
    <li className="flex gap-3 py-2.5" data-testid="whats-new-item">
      <Badge tone={TAG[i.kind].tone} className="mt-0.5 h-fit w-14 shrink-0 justify-center">
        {TAG[i.kind].label}
      </Badge>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{i.title}</p>
        {i.text && <p className="mt-0.5 text-sm text-slate-600">{i.text}</p>}
        {showMe && i.link && (
          <Link href={i.link} onClick={onGo} className="mt-1 inline-block text-sm text-accent-700 hover:underline">
            Show me
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * The What's new window (ver_88): opens over whatever page you land on, once per
 * version. Got it, ✕, Esc and a click outside all mark it seen.
 */
export function WhatsNewWindow({ entries }: { entries: WhatsNewEntry[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const path = usePathname();
  const spelling = useSpelling();
  const [done, setDone] = useState(false);
  // Not on the What's new page itself (it lists the same), and not while signing in.
  const skip = path === "/whats-new" || path.startsWith("/signin") || path.startsWith("/reset");

  useEffect(() => {
    const d = ref.current;
    if (d && !done && !skip && !d.open) d.showModal();
  }, [done, skip]);

  if (done || skip || !entries.length) return null;
  const [newest, ...older] = entries;
  const seen = () => {
    setDone(true);
    void markWhatsNewSeen();
  };
  // Closing fires the dialog's close event, which marks it seen.
  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      aria-labelledby="whats-new-title"
      onClose={seen}
      onClick={(e) => e.target === ref.current && close()}
      className="m-auto max-h-[min(36rem,calc(100%-2rem))] w-[min(34rem,calc(100%-2rem))] flex-col rounded-xl bg-surface p-0 shadow-xl backdrop:bg-black/50 open:flex"
      data-testid="whats-new-window"
    >
      <header className="flex items-start gap-3 border-b border-slate-200 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id="whats-new-title" className="text-base font-semibold text-slate-900">
            What&apos;s new in Flaw Patrol
          </h2>
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            {older.length ? `Versions ${entries[entries.length - 1].version} to ${newest.version} · since you last signed in` : `Version ${newest.version} · ${shortDate(newest.date, spelling)}`}
            <InfoTip
              text={
                older.length
                  ? "Every version you missed, newest open on top, older ones folded. Up to 5 versions; anything older is on the What's new page."
                  : "Shown once to each person, the first time they open Flaw Patrol after a new version is installed."
              }
            />
          </p>
        </div>
        <button type="button" aria-label="Close" title="Closing counts as seen. It won't open by itself again until the next version." onClick={close} className="rounded px-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          ✕
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
        {older.length > 0 && <p className="pt-2 text-xs font-semibold text-slate-600">Version {newest.version} · {shortDate(newest.date, spelling)}</p>}
        <ul className="divide-y divide-slate-100">
          {newest.items.map((i) => (
            <WhatsNewLine key={i.title} i={i} showMe onGo={close} />
          ))}
        </ul>
        {older.map((e) => (
          <details key={e.version} className="border-t border-slate-200 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-800">
              Version {e.version}{" "}
              <span className="font-normal text-slate-500">
                · {shortDate(e.date, spelling)} · {e.items.length} {e.items.length === 1 ? "change" : "changes"}
              </span>
            </summary>
            <ul className="divide-y divide-slate-100">
              {e.items.map((i) => (
                <WhatsNewLine key={i.title} i={i} />
              ))}
            </ul>
          </details>
        ))}
      </div>
      <footer className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
        <Link href="/whats-new" onClick={close} className="text-sm text-accent-700 hover:underline" title="Opens the What's new page with every past version">
          All past updates
        </Link>
        <Button variant="primary" onClick={close} autoFocus title="Marks this version as seen. Esc, ✕ or clicking outside do the same.">
          Got it
        </Button>
      </footer>
    </dialog>
  );
}
