"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { placeholdersIn, type PlainStep, type SharedStepParam } from "@/lib/steps";
import { saveSharedStep, setSharedStepArchived } from "@/server/shared-steps";
import { Button, ErrorText, Field, Input, Textarea } from "./ui";

export function SharedStepEditor({
  projectId,
  projectKey,
  sharedStepId,
  usageCount,
  initial,
}: {
  projectId: string;
  projectKey: string;
  sharedStepId: string | null;
  usageCount: number;
  initial: { name: string; description: string; parameters: SharedStepParam[]; steps: PlainStep[] };
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [parameters, setParameters] = useState(initial.parameters);
  const [steps, setSteps] = useState(initial.steps.length ? initial.steps : [{ action: "", expected: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const used = placeholdersIn(steps);
  const undeclared = used.filter((u) => !parameters.some((p) => p.name === u));
  const unused = parameters.filter((p) => !used.includes(p.name)).map((p) => p.name);

  const setStep = (i: number, patch: Partial<PlainStep>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const moveStep = (i: number, to: number) =>
    setSteps((s) => {
      if (to < 0 || to >= s.length) return s;
      const n = [...s];
      const [x] = n.splice(i, 1);
      n.splice(to, 0, x);
      return n;
    });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveSharedStep(projectId, sharedStepId, { name, description, parameters, steps });
      if (!res.ok) return setError(res.error);
      router.push(`/p/${projectKey}/shared-steps/${res.id}`);
      router.refresh();
    });

  return (
    <form
      className="mx-auto max-w-4xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{sharedStepId ? "Edit shared step" : "New shared step"}</h1>
        <div className="flex gap-2">
          <Button onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending} data-howto="shared-save">
            {sharedStepId ? "Save new version" : "Create shared step"}
          </Button>
        </div>
      </div>
      {sharedStepId && usageCount > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {usageCount} {usageCount === 1 ? "case uses" : "cases use"} this shared step. Saving updates all of them; past results keep the version they ran.
        </p>
      )}
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
        <Field label="Name" htmlFor="name">
          <Input id="name" data-howto="shared-name" required autoFocus={!sharedStepId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Log in as {{role}}" />
        </Field>
        <Field label="Description" htmlFor="description">
          <Textarea id="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
        </Field>
      </div>

      <div className="rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Parameters</h2>
          <Button size="sm" onClick={() => setParameters((p) => [...p, { name: "", defaultValue: "" }])}>
            + Add parameter
          </Button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Write <code className="rounded bg-slate-100 px-1">{"{{name}}"}</code> in a step and each case that uses this block fills in its own value.
        </p>
        {parameters.length === 0 && undeclared.length === 0 && <p className="text-sm text-slate-500">No parameters.</p>}
        <ul className="space-y-2">
          {parameters.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Parameter name"
                className="w-44 font-mono text-xs"
                value={p.name}
                placeholder="role"
                onChange={(e) => setParameters((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                aria-label="Default value"
                className="w-56 text-xs"
                value={p.defaultValue}
                placeholder="Default value (optional)"
                onChange={(e) => setParameters((ps) => ps.map((x, j) => (j === i ? { ...x, defaultValue: e.target.value } : x)))}
              />
              {unused.includes(p.name) && p.name && <span className="text-xs text-amber-700">not used in any step</span>}
              <button type="button" className="text-sm text-slate-400 hover:text-red-600" aria-label="Remove parameter" onClick={() => setParameters((ps) => ps.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {undeclared.length > 0 && (
          <p className="mt-2 text-xs text-slate-600">
            Also found in steps: {undeclared.map((u) => <code key={u} className="mr-1 rounded bg-slate-100 px-1">{u}</code>)}
            <button
              type="button"
              className="ml-1 text-accent-700 hover:underline"
              onClick={() => setParameters((p) => [...p, ...undeclared.map((n) => ({ name: n, defaultValue: "" }))])}
            >
              Add them
            </button>
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Steps</h2>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 rounded-lg border border-slate-200 bg-surface p-3 shadow-sm">
              <span className="w-6 pt-1 text-sm font-semibold text-slate-500">{i + 1}</span>
              <div className="grid flex-1 gap-2 md:grid-cols-2">
                <Textarea rows={2} data-howto="shared-step" aria-label={`Step ${i + 1} action`} placeholder="Action" value={s.action} onChange={(e) => setStep(i, { action: e.target.value })} />
                <Textarea rows={2} aria-label={`Step ${i + 1} expected result`} placeholder="Expected result" value={s.expected} onChange={(e) => setStep(i, { expected: e.target.value })} />
              </div>
              <div className="flex flex-col gap-0.5 text-sm text-slate-400">
                <button type="button" aria-label="Move up" disabled={i === 0} className="h-6 w-6 rounded hover:bg-slate-100 disabled:invisible" onClick={() => moveStep(i, i - 1)}>
                  ↑
                </button>
                <button type="button" aria-label="Move down" disabled={i === steps.length - 1} className="h-6 w-6 rounded hover:bg-slate-100 disabled:invisible" onClick={() => moveStep(i, i + 1)}>
                  ↓
                </button>
                <button type="button" aria-label="Remove step" className="h-6 w-6 rounded hover:bg-slate-100" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ol>
        <Button size="sm" className="mt-2" onClick={() => setSteps((s) => [...s, { action: "", expected: "" }])} data-howto="shared-add-step">
          + Add step
        </Button>
      </div>
    </form>
  );
}

export function ArchiveSharedButton({ projectId, sharedStepId, archived, usageCount }: { projectId: string; sharedStepId: string; archived: boolean; usageCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant={archived ? "secondary" : "danger"}
      disabled={pending}
      onClick={() => {
        if (!archived && usageCount > 0 && !confirm(`${usageCount} cases use this. They keep working, but it can't be inserted into new cases. Archive it?`)) return;
        start(async () => {
          await setSharedStepArchived(projectId, sharedStepId, !archived);
          router.refresh();
        });
      }}
    >
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}
