"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { jiraPriorities, saveJiraPriority } from "@/server/jira";
import { InfoTip, Select } from "./ui";

/** The bug box's quiet line: the Jira Priority this bug gets, set for the whole test cycle. */
export function PriorityLine({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return (
    <p className="text-xs text-slate-500" data-testid="bug-priority">
      Jira Priority: <span className="font-medium text-slate-700">{priority}</span> (set in Settings → Jira)
    </p>
  );
}

/**
 * Settings → Jira connection → Jira Priority: the priority every new bug
 * gets, "Not Prioritized" unless changed, so whoever triages sets the real one.
 */
export function PrioritySettings({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ options: string[]; onScreen: boolean; required: boolean; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    void jiraPriorities(projectId).then((res) => {
      if (!live) return;
      if (!res.ok) return setError(res.error);
      // Never picked: what new bugs get now ("Not Prioritized", or Jira's own default when it has none).
      setData({ options: res.options, onScreen: res.onScreen, required: res.required, value: res.setting ?? res.current ?? "" });
    });
    return () => {
      live = false;
    };
  }, [projectId]);
  const save = (value: string) => {
    setData((d) => (d ? { ...d, value } : d));
    setSaved(false);
    start(async () => {
      const res = await saveJiraPriority(projectId, value);
      if (!res.ok) return setError(res.error);
      setError(null);
      setSaved(true);
      router.refresh();
    });
  };
  return (
    <div className="space-y-1.5 border-t border-slate-100 pt-3" data-testid="jira-priority">
      <label htmlFor="jira-priority" className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
        Jira Priority on new bugs
        <InfoTip text="Set on every bug filed from here, whichever layout it uses. Change a bug's priority in Jira when it's triaged." />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {!data ? (
        !error && <p className="text-xs text-slate-500">Checking…</p>
      ) : !data.onScreen ? (
        <p className="text-xs text-slate-500">This Jira project doesn&apos;t let Flaw Patrol set Priority, so Jira picks it.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select id="jira-priority" value={data.value} onChange={(e) => save(e.target.value)} disabled={pending} className="w-auto min-w-48 max-w-full">
            {data.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="">Leave it to Jira</option>
          </Select>
          <span className="text-xs text-slate-500" role="status">
            {pending ? "Saving…" : saved ? "Saved." : data.value ? "Change it in Jira when the bug is triaged." : data.required ? "Jira uses its own default priority." : "Bugs go in without a priority."}
          </span>
        </div>
      )}
    </div>
  );
}
