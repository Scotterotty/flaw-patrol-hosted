"use client";

import { useState, useTransition } from "react";
import { TEXT_SIZES, type TextSize } from "@/lib/theme";
import { updateMyAccessibility } from "@/server/account";
import { Sp } from "./spelling";
import { cx, ErrorText } from "./ui";

type Settings = { textSize: TextSize; reduceMotion: boolean; strongContrast: boolean; underlineLinks: boolean };

const AIDS = [
  { key: "strongContrast", label: "Stronger contrast", help: "Darker secondary text and clearer borders." },
  { key: "underlineLinks", label: "Underline links", help: "So links don't rely on color alone. Links in sentences are always underlined; this underlines the rest too." },
  { key: "reduceMotion", label: "Reduce motion", help: "Turns off animations and transitions." },
] as const;

/** Text size and display aids. Applies instantly and saves to your account. */
export function AccessibilitySettings({ initial }: { initial: Settings }) {
  const [a, setA] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const save = (change: Partial<Settings>) => {
    const next = { ...a, ...change };
    setA(next);
    const root = document.documentElement.dataset;
    root.textSize = next.textSize;
    if (next.reduceMotion) root.motion = "reduce";
    else delete root.motion;
    if (next.strongContrast) root.contrast = "more";
    else delete root.contrast;
    if (next.underlineLinks) root.links = "underline";
    else delete root.links;
    start(async () => {
      const res = await updateMyAccessibility(next);
      setError(res.ok ? null : res.error);
    });
  };

  return (
    <div className="space-y-4">
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-900">Text size</legend>
        <div className="flex flex-wrap gap-2">
          {TEXT_SIZES.map((t) => (
            <label
              key={t.id}
              className={cx(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-slate-700",
                a.textSize === t.id ? "border-accent-600 ring-2 ring-accent-500/30" : "border-slate-200 hover:border-slate-300",
              )}
            >
              <input type="radio" name="text-size" value={t.id} checked={a.textSize === t.id} onChange={() => save({ textSize: t.id })} className="sr-only" />
              <span aria-hidden="true" className="font-semibold" style={{ fontSize: `${(Number(t.id) / 100) * 0.875}rem` }}>
                A
              </span>
              <span className="text-xs">{t.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">Makes all text and controls bigger or smaller, like zooming the page.</p>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {AIDS.map((o) => (
          <div key={o.key}>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={a[o.key]}
                onChange={(e) => save({ [o.key]: e.target.checked })}
                aria-describedby={`a11y-${o.key}`}
                className="size-4 accent-accent-600"
              />
              {o.label}
            </label>
            <p id={`a11y-${o.key}`} className="mt-0.5 ml-6 text-xs text-slate-500">
              <Sp>{o.help}</Sp>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
