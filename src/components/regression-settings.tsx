"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { COMPARE_MODES, type RegressionSettings } from "@/lib/regression";
import { saveRegressionSettings } from "@/server/regression";
import { useCloseRow } from "./settings-row";
import { Button, ErrorText, Field, Input, Select } from "./ui";

/** Umbrella Settings → Regression flag: on or off, what counts as "used to pass", and the Jira label. */
export function RegressionPanel({ groupId, settings, canEdit }: { groupId: string; settings: RegressionSettings; canEdit: boolean }) {
  const router = useRouter();
  const close = useCloseRow();
  const [s, setS] = useState(settings);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mode = COMPARE_MODES.find((m) => m.id === s.compare)!;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveRegressionSettings(groupId, s);
          if (!r.ok) return setError(r.error);
          setError(null);
          router.refresh();
          close();
        });
      }}
    >
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <label className="flex items-start gap-2 text-sm text-slate-800">
        <input type="checkbox" className="mt-1" checked={s.on} disabled={!canEdit} onChange={(e) => setS({ ...s, on: e.target.checked })} />
        <span>
          Flag tests that passed before and fail now
          <span className="block text-xs text-slate-500">Turn off to hide the Regression badge, filter, report tab and Jira label everywhere in this umbrella.</span>
        </span>
      </label>
      <Field label="Compare with" hint={mode.tip}>
        <Select value={s.compare} disabled={!canEdit || !s.on} onChange={(e) => setS({ ...s, compare: e.target.value as RegressionSettings["compare"] })} className="w-auto">
          {COMPARE_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Jira label" hint="Added to a bug when “Mark as a regression in Jira” is ticked in the bug box. No spaces.">
        <Input value={s.label} disabled={!canEdit || !s.on} onChange={(e) => setS({ ...s, label: e.target.value.replace(/\s/g, "") })} className="w-56" />
      </Field>
      <p className="text-xs text-slate-500">To tell Slack, tick Regression on a channel in Slack alerts above.</p>
      {canEdit && (
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      )}
    </form>
  );
}
