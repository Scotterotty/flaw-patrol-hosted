"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPlanValue, assignPlanRun, copyPlan, setPlanState, splitPlan } from "@/server/plans";
import { Button, ErrorText, Field, Input, Select } from "./ui";

type Member = { id: string; name: string };

/** One run's tester on the plan page: every case in that run goes to them. */
export function PlanRunTester({ projectId, planId, runId, label, testerId, mixed, members, disabled }: { projectId: string; planId: string; runId: string; label: string; testerId: string | null; mixed: boolean; members: Member[]; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <Select
        aria-label={`Tester for ${label}`}
        className="h-8 w-auto min-w-32 max-w-48 py-0 text-xs"
        value={mixed ? "__mixed" : (testerId ?? "")}
        disabled={disabled || pending}
        data-howto="plan-tester"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__mixed") return;
          start(async () => {
            const r = await assignPlanRun(projectId, planId, runId, v || null);
            if (!r.ok) return setError(r.error);
            setError(null);
            router.refresh();
          });
        }}
      >
        {mixed && <option value="__mixed">Several people</option>}
        <option value="">Nobody yet</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

type Panel = "add" | "split" | "copy" | "close" | null;

/**
 * The plan page's tools: add a run for another value, share the runs out, copy the plan to
 * another test cycle, and close (or reopen) every run at once.
 */
export function PlanTools({
  projectId,
  planId,
  closed,
  configs,
  members,
  cycles,
  unfinished,
  runCount,
  canCreate,
  canAssign,
  canManage,
  canRemember,
}: {
  projectId: string;
  planId: string;
  closed: boolean;
  /** Each Configuration in the plan, with the umbrella's values not in it yet. */
  configs: { name: string; more: string[] }[];
  members: Member[];
  cycles: { id: string; name: string }[];
  /** Runs with cases still to test, listed before Close the plan. */
  unfinished: string[];
  runCount: number;
  canCreate: boolean;
  canAssign: boolean;
  canManage: boolean;
  /** Can also add a typed value to the umbrella's Configuration. */
  canRemember: boolean;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [cfg, setCfg] = useState(configs[0]?.name ?? "");
  const more = configs.find((c) => c.name === cfg)?.more ?? [];
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  const [remember, setRemember] = useState(true);
  const [people, setPeople] = useState<string[]>([]);
  const [target, setTarget] = useState(cycles[0]?.id ?? "");
  const open = (p: Panel) => {
    setError(null);
    setNote(null);
    setPanel(panel === p ? null : p);
  };
  const run = (f: () => Promise<{ ok: true; note: string; to?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await f();
      if (!r.ok) return setError(r.error);
      setError(null);
      setPanel(null);
      setNote(r.note);
      if (r.to) router.push(r.to);
      else router.refresh();
    });
  const value = (pick === "__typed" || !more.length ? typed : pick).trim();

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {canCreate && !closed && (
          <Button size="sm" aria-expanded={panel === "add"} onClick={() => open("add")} data-howto="plan-add">
            ＋ Add a run for another value
          </Button>
        )}
        {canAssign && !closed && members.length > 0 && (
          <Button size="sm" aria-expanded={panel === "split"} onClick={() => open("split")} data-howto="plan-split">
            Share out the runs
          </Button>
        )}
        {canCreate && cycles.length > 0 && (
          <Button size="sm" aria-expanded={panel === "copy"} onClick={() => open("copy")} data-howto="plan-copy">
            Copy to another test cycle
          </Button>
        )}
        {canManage &&
          (closed ? (
            <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await setPlanState(projectId, planId, "ACTIVE"); return r.ok ? { ok: true, note: `Reopened ${r.runs} runs.` } : r; })}>
              Reopen the plan
            </Button>
          ) : (
            <Button size="sm" aria-expanded={panel === "close"} onClick={() => open("close")} data-howto="plan-close">
              Close the plan
            </Button>
          ))}
      </div>
      {note && (
        <p role="status" className="text-sm text-emerald-800">
          {note}
        </p>
      )}
      {panel && (
        <div className="w-full max-w-xl space-y-3 rounded-lg border border-slate-200 bg-surface p-3 text-left text-sm shadow-sm">
          {panel === "add" && (
            <form
              className="space-y-2.5"
              aria-label="Add a run for another value"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const r = await addPlanValue(projectId, planId, { name: cfg, value, remember: canRemember && remember && !more.includes(value) });
                  return r.ok ? { ok: true, note: `Added ${r.runs === 1 ? "1 run" : `${r.runs} runs`} for ${value}.${r.remembered ? ` ${value} is in the ${cfg} Configuration now too.` : ""}` } : r;
                });
              }}
            >
              <p className="text-slate-600">A new value arrived mid-RC? It gets its own run in this plan{configs.length > 1 ? ", paired with each value of the other Configuration" : ""}.</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {configs.length > 1 && (
                  <Field label="Configuration" htmlFor="plan-add-cfg">
                    <Select id="plan-add-cfg" value={cfg} onChange={(e) => { setCfg(e.target.value); setPick(""); }}>
                      {configs.map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                {more.length > 0 && (
                  <Field label={`${cfg} value`} htmlFor="plan-add-pick">
                    <Select id="plan-add-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
                      <option value="">Pick one…</option>
                      {more.map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                      <option value="__typed">Type a new one…</option>
                    </Select>
                  </Field>
                )}
                {(!more.length || pick === "__typed") && (
                  <Field label={`New ${cfg} value`} htmlFor="plan-add-typed">
                    <Input id="plan-add-typed" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={120} autoFocus />
                  </Field>
                )}
              </div>
              {canRemember && (!more.length || pick === "__typed") && (
                <label className="flex items-center gap-2 text-slate-800">
                  <input type="checkbox" className="accent-accent-600" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Also add it to the {cfg} Configuration, for next time
                </label>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" variant="primary" disabled={pending || !value}>
                  {pending ? "Adding…" : "Add the run"}
                </Button>
              </div>
            </form>
          )}
          {panel === "split" && (
            <div className="space-y-2.5">
              <p className="text-slate-600">Tick testers and each open run goes to one of them in turn. Each tester sees their runs in My assigned cases. You can still change one run with its Tester box.</p>
              <fieldset className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                <legend className="sr-only">Testers</legend>
                {members.map((m) => (
                  <label key={m.id} className="flex min-w-0 items-center gap-2 text-slate-800">
                    <input type="checkbox" className="accent-accent-600" checked={people.includes(m.id)} onChange={(e) => setPeople(e.target.checked ? [...people, m.id] : people.filter((p) => p !== m.id))} />
                    <span className="truncate">{m.name}</span>
                  </label>
                ))}
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending || !people.length}
                  onClick={() =>
                    run(async () => {
                      const r = await splitPlan(projectId, planId, people);
                      return r.ok ? { ok: true, note: `Shared ${r.runs} runs across ${people.length === 1 ? "1 tester" : `${people.length} testers`}.` } : r;
                    })
                  }
                >
                  {pending ? "Sharing…" : "Split evenly"}
                </Button>
              </div>
            </div>
          )}
          {panel === "copy" && (
            <div className="space-y-2.5">
              <p className="text-slate-600">Makes the same plan there: same values and cases, fresh results. Version starts blank.</p>
              <Field label="Copy to" htmlFor="plan-copy-to">
                <Select id="plan-copy-to" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending || !target}
                  onClick={() =>
                    run(async () => {
                      const r = await copyPlan(projectId, planId, target);
                      return r.ok ? { ok: true, note: `Copied, ${r.runs} runs.`, to: `/p/${r.key}/plans/${r.number}` } : r;
                    })
                  }
                >
                  {pending ? "Copying…" : `Copy ${runCount} runs`}
                </Button>
              </div>
            </div>
          )}
          {panel === "close" && (
            <div className="space-y-2.5">
              {unfinished.length ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                  <p className="font-medium">{unfinished.length === 1 ? "1 run still has cases to test:" : `${unfinished.length} runs still have cases to test:`}</p>
                  <p>{unfinished.join(", ")}</p>
                </div>
              ) : (
                <p className="text-slate-600">Every run in this plan is finished.</p>
              )}
              <p className="text-slate-600">Closing the plan closes all {runCount} runs. You can reopen it later.</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setPanel(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const r = await setPlanState(projectId, planId, "COMPLETED");
                      return r.ok ? { ok: true, note: `Closed ${r.runs} runs.` } : r;
                    })
                  }
                >
                  {pending ? "Closing…" : `Close all ${runCount} runs`}
                </Button>
              </div>
            </div>
          )}
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}
