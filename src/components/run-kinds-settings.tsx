"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RunKindDef } from "@/lib/run-kinds";
import { setRunKinds } from "@/server/start-run";
import { Badge, Button, ErrorText, Field, Input, Select } from "./ui";

/**
 * Umbrella Settings → Run kinds (ver_95): what Start a run asks first. Smoke test and
 * Release candidate can be renamed or hidden; Bug bash is always there. Each kind can
 * have a usual suite, which fills in "What to run". Saves on each change.
 */
export function RunKindsPanel({ groupId, umbrella, kinds: initial, suites, canEdit, newSuiteHref }: { groupId: string; umbrella: string; kinds: RunKindDef[]; suites: { id: string; name: string }[]; canEdit: boolean; newSuiteHref?: string }) {
  const [kinds, setKinds] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", suiteId: "" });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = (next: RunKindDef[], after?: () => void) =>
    start(async () => {
      const r = await setRunKinds(
        groupId,
        next.map((k) => ({ id: k.id || undefined, name: k.name, suiteId: k.suiteId, hidden: k.hidden })),
      );
      if (!r.ok) return setError(r.error);
      setError(null);
      setKinds(r.kinds);
      after?.();
      router.refresh();
    });
  const suiteName = (id: string | null) => suites.find((s) => s.id === id)?.name;
  const edit = (k: RunKindDef) => {
    setAdding(false);
    setEditing(k.id);
    setDraft({ name: k.name, suiteId: k.suiteId ?? "" });
  };
  const form = (onSave: () => void, onCancel: () => void, nameLocked = false) => (
    <div className="grid gap-2 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
      <Field label="Name" htmlFor="rk-name">
        <Input id="rk-name" value={draft.name} disabled={nameLocked} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Regression" maxLength={60} />
      </Field>
      <Field label="Usual suite (optional)" htmlFor="rk-suite">
        {suites.length ? (
          <Select id="rk-suite" value={draft.suiteId} onChange={(e) => setDraft({ ...draft, suiteId: e.target.value })}>
            <option value="">None</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : (
          // No suites yet (ver_118): a plain line instead of a list with only None.
          <p id="rk-suite" className="flex min-h-9 flex-wrap items-center gap-x-2 text-sm text-slate-500" data-testid="no-suites-optional">
            No suites yet. That&apos;s fine, it&apos;s optional.
            {newSuiteHref && (
              <a href={newSuiteHref} target="_blank" rel="noopener" className="font-medium text-accent-700 underline">
                Make a suite ↗
              </a>
            )}
          </p>
        )}
      </Field>
      <span className="flex gap-1.5">
        <Button variant="primary" size="sm" disabled={pending || !draft.name.trim()} onClick={onSave}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </div>
  );
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        <b>Start a run</b> asks which kind of run it is first. A kind&apos;s usual suite fills in what to run. Each run keeps its kind, so run lists and Reports can show
        and filter by it. Release status counts release candidates and plain runs only.
      </p>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-label={`${umbrella} run kinds`}>
        {kinds.map((k) => (
          <li key={k.id} className="px-3 py-2">
            {editing === k.id ? (
              form(
                () => save(kinds.map((x) => (x.id === k.id ? { ...x, name: draft.name.trim(), suiteId: draft.suiteId || null } : x)), () => setEditing(null)),
                () => setEditing(null),
                k.id === "bash",
              )
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className={k.hidden ? "font-medium text-slate-400 line-through" : "font-medium text-slate-900"}>{k.name}</span>
                {k.builtIn && <Badge>Built in</Badge>}
                {k.hidden && <Badge tone="orange">Hidden</Badge>}
                <span className="text-xs text-slate-500">
                  {k.id === "rc" ? "Opens the release box: one test cycle per platform" : k.id === "bash" ? "Opens the bug bash box" : suiteName(k.suiteId) ? `Usually runs ${suiteName(k.suiteId)}` : "No usual suite"}
                </span>
                <span className="flex-1" />
                {canEdit && (
                  <span className="flex gap-1">
                    {k.id !== "bash" && k.id !== "rc" && (
                      <Button size="sm" variant="ghost" onClick={() => edit(k)}>
                        Edit
                      </Button>
                    )}
                    {k.id === "rc" && (
                      <Button size="sm" variant="ghost" onClick={() => edit(k)}>
                        Rename
                      </Button>
                    )}
                    {k.builtIn && k.id !== "bash" && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(kinds.map((x) => (x.id === k.id ? { ...x, hidden: !x.hidden } : x)))}>
                        {k.hidden ? "Show" : "Hide"}
                      </Button>
                    )}
                    {!k.builtIn && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(kinds.filter((x) => x.id !== k.id))}>
                        Remove
                      </Button>
                    )}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit &&
        (adding ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3">
            {form(
              () => save([...kinds, { id: "", name: draft.name.trim(), suiteId: draft.suiteId || null, builtIn: false, hidden: false }], () => setAdding(false)),
              () => setAdding(false),
            )}
          </div>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDraft({ name: "", suiteId: "" });
              setAdding(true);
            }}
          >
            ＋ Add a kind
          </Button>
        ))}
      {!canEdit && <p className="text-xs text-slate-500">Admins can change these. Anyone who starts runs can add a kind from Start a run.</p>}
    </div>
  );
}
