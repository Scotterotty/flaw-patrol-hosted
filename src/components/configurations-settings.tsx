"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { blankHint, MAX_CONFIGURATIONS, valuesFromText, type Configuration } from "@/lib/configurations";
import { setConfigurations } from "@/server/plans";
import { Button, ErrorText, Field, Input, Textarea } from "./ui";

type Editing = { id?: string; name: string; values: string } | null;

/**
 * Umbrella Settings → Configurations: named sets of values, like Platforms or Languages.
 * Create a run ticks values from them and makes one run per value, as a test plan.
 */
export function ConfigurationsPanel({ groupId, umbrella, configurations: initial, canEdit }: { groupId: string; umbrella: string; configurations: Configuration[]; canEdit: boolean }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (next: { id?: string; name: string; values: string }[], after?: () => void) =>
    start(async () => {
      const r = await setConfigurations(groupId, next);
      if (!r.ok) return setError(r.error);
      setError(null);
      setList(r.configurations);
      after?.();
      router.refresh();
    });
  const asInput = (c: Configuration) => ({ id: c.id, name: c.name, values: c.values.join("\n") });
  const submit = () => {
    if (!editing) return;
    const rest: { id?: string; name: string; values: string }[] = list.filter((c) => c.id !== editing.id).map(asInput);
    const at = editing.id ? list.findIndex((c) => c.id === editing.id) : list.length;
    rest.splice(at < 0 ? rest.length : at, 0, editing);
    save(rest, () => setEditing(null));
  };
  const typed = editing ? valuesFromText(editing.values).length : 0;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        A Configuration is a named set of values, like Platforms or Languages. When you create a run in any {umbrella} test cycle, tick the values to test and Flaw Patrol makes one run for each, grouped as a test plan.
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {list.length ? (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Configurations">
          {list.map((c) => (
            <li key={c.id} className="space-y-2 rounded-lg border border-slate-200 bg-surface p-3" data-testid="configuration">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-slate-900">{c.name}</span>
                <span className="text-xs text-slate-500">{c.values.length === 1 ? "1 value" : `${c.values.length} values`}</span>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label={`${c.name} values`}>
                {c.values.slice(0, 24).map((v) => (
                  <li key={v} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-800">
                    {v}
                  </li>
                ))}
                {c.values.length > 24 && <li className="px-1 text-xs text-slate-500">+ {c.values.length - 24} more</li>}
              </ul>
              <p className="text-xs text-slate-500">
                Steps that say <code className="rounded bg-slate-100 px-1 text-slate-700">{blankHint(c.name)}</code> get the run&apos;s value.
              </p>
              {canEdit && (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${c.name}`} onClick={() => save(list.filter((x) => x.id !== c.id).map(asInput))}>
                    Remove
                  </Button>
                  <Button size="sm" disabled={pending} aria-label={`Edit ${c.name}`} onClick={() => setEditing(asInput(c))}>
                    Edit
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-slate-500">No Configurations yet. Add one if you test the same cases on several platforms, languages or other values.</p>
      )}
      {list.length > 0 && <p className="text-xs text-slate-500">Editing values never changes runs already made, so old results stay true.</p>}
      {canEdit &&
        (editing ? (
          <form
            className="max-w-xl space-y-2.5 rounded-lg border border-slate-200 p-3"
            aria-label={editing.id ? `Edit ${editing.name}` : "New Configuration"}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Name" htmlFor="cfg-name">
              <Input id="cfg-name" data-howto="config-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required maxLength={60} autoFocus placeholder="For example Platforms" />
            </Field>
            <Field label="Values, one per line (paste from a sheet)" htmlFor="cfg-values" hint={typed ? (typed === 1 ? "1 value" : `${typed} values`) : undefined}>
              <Textarea id="cfg-values" data-howto="config-values" rows={6} value={editing.values} onChange={(e) => setEditing({ ...editing, values: e.target.value })} required placeholder={"Windows\nMac\niPhone\nAndroid"} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={pending || !editing.name.trim() || !typed} data-howto="config-save">
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        ) : list.length < MAX_CONFIGURATIONS ? (
          <Button size="sm" onClick={() => setEditing({ name: "", values: "" })} data-howto="config-add">
            ＋ New Configuration
          </Button>
        ) : (
          <p className="text-xs text-slate-500">{MAX_CONFIGURATIONS} Configurations is the most an umbrella can have.</p>
        ))}
    </div>
  );
}
