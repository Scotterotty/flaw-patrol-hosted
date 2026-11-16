"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { answerReadingBanner, setEasierReading } from "@/server/account";
import { Button, ErrorText } from "./ui";

type View = "ask" | "on" | "kept" | "off" | "later" | "closed";

/** Turns Easier reading on or off on this page right away; the account keeps it for next time. */
export function applyReading(on: boolean) {
  if (on) document.documentElement.dataset.reading = "easier";
  else delete document.documentElement.dataset.reading;
}

/**
 * The one-time Easier reading banner (ver_265), on the home and umbrella pages. Try it turns it
 * on at once and offers Keep it or Turn it off; Not now asks once more in two weeks; × is no.
 * Every way out says where the switch lives, so nobody loses the option.
 */
export function ReadingBanner() {
  const [view, setView] = useState<View>("ask");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const run = (next: View, work: () => Promise<{ ok: boolean; error?: string }>) => {
    setView(next);
    start(async () => {
      const res = await work();
      setError(res.ok ? null : (res.error ?? "Couldn't save that."));
    });
  };
  const where = (
    <Link href="/account#accessibility" className="underline">
      your account menu
    </Link>
  );

  if (view === "kept" || view === "off" || view === "later" || view === "closed") {
    return (
      <p role="status" className="mb-4 text-sm text-slate-600" data-testid="reading-banner-done">
        {view === "kept" && <span className="text-emerald-700">Saved. You won&apos;t see this again.</span>}
        {view === "off" && <>Turned off. You can switch it back on from {where}.</>}
        {view === "later" && <>Okay. We&apos;ll ask once more in a couple of weeks.</>}
        {view === "closed" && <>Dismissed. It&apos;s always in {where} if you change your mind.</>}
        {error && <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>}
      </p>
    );
  }

  const on = view === "on";
  return (
    <section
      aria-label="Easier reading"
      data-testid="reading-banner"
      className={on ? "mb-4 flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5" : "mb-4 flex gap-3 rounded-lg border border-accent-500/30 bg-accent-50 p-3.5"}
    >
      <span aria-hidden className={on ? "mt-0.5 text-lg text-emerald-700" : "mt-0.5 text-lg text-accent-600"}>
        {on ? "✓" : "Aa"}
      </span>
      <div className="min-w-0 flex-1" role={on ? "status" : undefined}>
        <p className="text-sm font-semibold text-slate-900">{on ? "Easier reading is on" : "Try easier reading"}</p>
        <p className="mt-0.5 text-sm text-slate-700">
          {on ? (
            <>It&apos;s on for you everywhere in Flaw Patrol. Change it any time from your account menu or Your account → Accessibility.</>
          ) : (
            <>More space between letters and lines, and no all-caps headings. Some people find it easier on the eyes. You can turn it off any time.</>
          )}
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {on ? (
            <>
              <Button size="sm" variant="primary" onClick={() => setView("kept")}>
                Keep it
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  applyReading(false);
                  run("off", () => setEasierReading(false));
                }}
              >
                Turn it off
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  applyReading(true);
                  run("on", () => setEasierReading(true));
                }}
              >
                Try it
              </Button>
              <Button size="sm" onClick={() => run("later", () => answerReadingBanner("later"))}>
                Not now
              </Button>
            </>
          )}
        </div>
        {error && <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>}
      </div>
      {!on && (
        <button
          type="button"
          aria-label="Dismiss for good"
          title="Dismiss for good"
          onClick={() => run("closed", () => answerReadingBanner("done"))}
          className="h-fit rounded px-1 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          ×
        </button>
      )}
    </section>
  );
}
