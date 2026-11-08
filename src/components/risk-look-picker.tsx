"use client";

import { useState, useTransition } from "react";
import { RISK_LOOKS, type RiskLook } from "@/lib/risk-looks";
import { updateMyRiskLook } from "@/server/account";
import { cx, ErrorText } from "./ui";

/** Your account → Appearance → Risk board look. One chip per look; Classic is the default. */
export function RiskLookPicker({ initial }: { initial: RiskLook }) {
  const [look, setLook] = useState<RiskLook>(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const save = (next: RiskLook) => {
    const before = look;
    setLook(next);
    start(async () => {
      const res = await updateMyRiskLook(next);
      if (!res.ok) setLook(before);
      setError(res.ok ? null : res.error);
    });
  };
  return (
    <fieldset data-howto="appearance-risk-look" data-testid="risk-look-picker">
      <legend className="mb-2 text-sm font-semibold text-slate-900">Risk board look</legend>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        {RISK_LOOKS.map((l) => (
          <label
            key={l.id}
            title={l.help}
            className={cx(
              "cursor-pointer rounded-lg border px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500",
              look === l.id ? "border-accent-600 bg-accent-50 font-semibold text-accent-800 ring-2 ring-accent-500/30" : "border-slate-200 text-slate-700 hover:border-slate-300",
            )}
          >
            <input type="radio" name="risk-look" value={l.id} checked={look === l.id} onChange={() => save(l.id)} className="sr-only" />
            {l.label}
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">Only changes how the Risk board looks for you.</p>
    </fieldset>
  );
}
