"use client";

import { useEffect, useState } from "react";
import { SEASON_INFO, seasonFor } from "@/lib/seasons";
import { pickSpinner, type SpinnerId } from "@/lib/spinners";
import { cx } from "./ui";

/** One spinner's picture. Every one fills the same 48 px circle, scaled by `size`. */
export function SpinnerArt({ id, size = 48, pawn }: { id: SpinnerId; size?: number; pawn?: string }) {
  return (
    <span className="fp-spin" data-spinner={id} style={{ "--fp-spin-scale": size / 48 } as React.CSSProperties} aria-hidden="true">
      <span className="fp-spin-art">{art(id, pawn)}</span>
    </span>
  );
}

function art(id: SpinnerId, pawn?: string) {
  switch (id) {
    case "ring":
      return <i className="fp-ring" />;
    case "radar":
      return (
        <i className="fp-radar">
          <b>🐞</b>
        </i>
      );
    case "magnifier":
      return <i className="fp-emoji fp-sweep">🔍</i>;
    case "checks":
      return (
        <i className="fp-checks">
          <b>✓</b>
          <b>✓</b>
          <b>✓</b>
        </i>
      );
    case "pawn":
      return (
        <i className="fp-pawn">
          <b />
          <span>{pawn ?? "♟️"}</span>
          <b />
        </i>
      );
    case "bug":
      return (
        <i className="fp-orbit">
          <b>🐛</b>
        </i>
      );
    case "lights":
      return (
        <i className="fp-lights">
          <b />
          <b />
          <b />
        </i>
      );
    case "stopwatch":
      return <i className="fp-watch" />;
    case "dice":
      return <i className="fp-emoji fp-roll">🎲</i>;
    case "pulse":
      return <i className="fp-emoji fp-beat">❤️</i>;
    case "ink":
      return (
        <i className="fp-ink">
          <b />
          <span>🐙</span>
        </i>
      );
    case "crown":
      return <i className="fp-emoji fp-flip">👑</i>;
    case "seasonal":
      return <i className="fp-emoji fp-bob">{SEASON_INFO[seasonFor(new Date())].icon}</i>;
    case "paws":
      return (
        <i className="fp-paws">
          {[0, 1, 2, 3].map((n) => (
            <b key={n}>
              <PawPrint />
            </b>
          ))}
        </i>
      );
  }
}

/** One paw print (ver_245): a pad and four toes, in the Look's accent color. */
function PawPrint() {
  return (
    <svg viewBox="0 0 20 20">
      <ellipse cx="10" cy="13.6" rx="5" ry="4.3" />
      <circle cx="3.8" cy="8.2" r="2" />
      <circle cx="7.6" cy="4.4" r="2.1" />
      <circle cx="12.4" cy="4.4" r="2.1" />
      <circle cx="16.2" cy="8.2" r="2" />
    </svg>
  );
}

/**
 * The spinner for a long wait: one of the spinners this person ticked in
 * Account → Appearance, picked at random each time. It starts as the plain ring and
 * swaps in after the page loads, so the server and browser draw the same first frame.
 */
export function LoadingSpinner({ size = 48, className }: { size?: number; className?: string }) {
  const [mine, setMine] = useState<{ id: SpinnerId; pawn?: string }>({ id: "ring" });
  useEffect(() => {
    const d = document.documentElement.dataset;
    setMine({ id: pickSpinner(d.spinners?.split(" "), Math.random()), pawn: d.pawn });
  }, []);
  return (
    <span className={cx("inline-flex shrink-0", className)} data-testid="loading-spinner" data-spinner={mine.id}>
      <SpinnerArt id={mine.id} size={size} pawn={mine.pawn} />
    </span>
  );
}

/**
 * The strip a box shows while it works (ver_116): your spinner and what's happening.
 * It marks itself data-own-spinner so the corner spinner stays out of the way. Keep one strip
 * mounted through every phase so the spinner doesn't change halfway.
 */
export function BusyStrip({ testId, className, children }: { testId?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" data-own-spinner="" data-testid={testId} className={cx("flex items-center gap-3 rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-slate-800", className)}>
      <LoadingSpinner size={36} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
