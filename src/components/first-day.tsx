"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { closeAllSet, hideStartHere } from "@/server/first-day";
import { Button, Card, cx } from "./ui";

const SHOWN = "fp:start-here-shown";

/** Brings Start here back (account menu Getting started, or Show Start here again in the How-to guide) and opens the umbrella's Overview. */
export function useShowStartHere() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [pending, start] = useTransition();
  const show = () =>
    start(async () => {
      await hideStartHere(false);
      // A card hidden on this page stays mounted as hidden: tell it to show again.
      window.dispatchEvent(new Event(SHOWN));
      const m = /^\/g\/([^/?#]+)/.exec(pathname);
      router.push(m ? `/g/${m[1]}` : "/start");
      router.refresh();
    });
  return { show, pending };
}

/** Getting started in the account menu (ver_216): Start here again, ticks kept. */
export function GettingStartedItem({ className }: { className: string }) {
  const { show } = useShowStartHere();
  return (
    <button type="button" role="menuitem" className={className} onClick={show} data-howto="account-getting-started" data-testid="account-getting-started">
      Getting started
    </button>
  );
}

/** At the top of the How-to guide while Start here is hidden (ver_216). */
export function ShowStartHereAgain() {
  const { show, pending } = useShowStartHere();
  return (
    <button
      type="button"
      onClick={show}
      disabled={pending}
      data-howto="howto-start-again"
      data-testid="howto-start-again"
      className="mb-3 block w-full rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-left text-sm font-medium text-accent-800 hover:bg-accent-100"
    >
      Show Start here again
    </button>
  );
}

/**
 * The Start here card (ver_178, Members ver_187) with ✕ Hide for now (ver_216). Esc inside it hides it too.
 * Hidden for this person everywhere until Getting started brings it back; ticks are kept.
 */
export function StartHereCard({ progress, testId, children }: { progress: string; testId?: string; children: ReactNode }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const show = () => setHidden(false);
    window.addEventListener(SHOWN, show);
    return () => window.removeEventListener(SHOWN, show);
  }, []);
  const hide = () => {
    setHidden(true);
    void hideStartHere(true).then(() => router.refresh());
  };
  if (hidden) return null;
  return (
    <Card
      className="mb-6 p-4"
      data-testid={testId}
      data-howto="start-here"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        if (t.closest("input, textarea, select, [role=dialog], dialog")) return;
        e.preventDefault();
        hide();
      }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-semibold text-slate-900">Start here</h2>
        <span className="order-last w-full text-xs text-slate-600 sm:order-none sm:w-auto sm:flex-1">{progress}</span>
        <button
          type="button"
          onClick={hide}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
          data-howto="start-here-hide"
          data-testid="start-here-hide"
          title="Bring it back from your name at the top right → Getting started"
        >
          <span aria-hidden>✕ </span>Hide for now
        </button>
      </div>
      {children}
    </Card>
  );
}

/** Once per person, right after their first saved result (ver_216): what to do next, then Got it. */
export function AllSetCard({ first }: { first: string }) {
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    void closeAllSet();
  };
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !box.current?.contains(document.activeElement)) return;
      close();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  if (!open) return null;
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="region"
      aria-labelledby="all-set-title"
      data-testid="all-set"
      className="mb-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-slate-800 focus:outline-2 focus:outline-accent-500"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className="grid size-7 flex-none place-items-center rounded-full bg-emerald-700 font-bold text-white fp-pop">
          ✓
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="all-set-title" className="font-semibold text-slate-900">
            You&apos;re set{first ? `, ${first}` : ""}. First result saved.
          </h2>
          <p className="mt-1 text-slate-700">Three things that save time:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700">
            <li>
              Press <kbd>P</kbd> <kbd>F</kbd> <kbd>B</kbd> to mark steps. <kbd>Ctrl</kbd> + <kbd>Enter</kbd> saves and goes to the next case.
            </li>
            <li>
              <kbd>Ctrl</kbd> + <kbd>K</kbd> finds any case, run or bug.
            </li>
            <li>Stuck? The How-to guide in the left menu shows you how.</li>
          </ul>
        </div>
        <Button size="sm" variant="primary" onClick={close} className={cx("self-end")} data-testid="all-set-close">
          Got it
        </Button>
      </div>
    </div>
  );
}
