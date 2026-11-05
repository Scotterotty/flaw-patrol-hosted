"use client";

import type { CaseType, Priority } from "@prisma/client";
import { useState, useTransition } from "react";
import { normalizeTags, PRIORITIES, PRIORITY_LABEL } from "@/lib/format";
import { sortTags } from "@/lib/tags";
import { editCaseFields } from "@/server/cases";
import { Modal } from "./modal";
import { Button, ErrorText, Field, Input, Select } from "./ui";

export type BulkCase = { id: string; priority: Priority; type: CaseType; tags: string[]; personaId?: string | null };
export type BulkPersona = { id: string; name: string; emoji: string };

const KEEP = "";
const NO_PERSONA = "__none";

/** Edit fields… on the ticked cases: priority, type, persona and tags, one new version per changed case. */
export function BulkEditButton({
  projectId,
  cases,
  personas,
  knownTags,
  disabled,
  onDone,
}: {
  projectId: string;
  cases: BulkCase[];
  personas: BulkPersona[];
  knownTags: string[];
  disabled?: boolean;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="h-7 px-2.5 text-xs" disabled={disabled} onClick={() => setOpen(true)} data-howto="cases-edit-fields">
        Edit fields…
      </Button>
      {open && (
        <BulkEditDialog
          projectId={projectId}
          cases={cases}
          personas={personas}
          knownTags={knownTags}
          onClose={() => setOpen(false)}
          onDone={(m) => {
            setOpen(false);
            onDone(m);
          }}
        />
      )}
    </>
  );
}

function BulkEditDialog({
  projectId,
  cases,
  personas,
  knownTags,
  onClose,
  onDone,
}: {
  projectId: string;
  cases: BulkCase[];
  personas: BulkPersona[];
  knownTags: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [priority, setPriority] = useState<Priority | "">(KEEP);
  const [type, setType] = useState<"MANUAL" | "AUTOMATED" | "">(KEEP);
  const [persona, setPersona] = useState(KEEP);
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = cases.length;
  const plural = (k: number) => `${k} ${k === 1 ? "case" : "cases"}`;
  const tagsOnCases = sortTags(new Set(cases.flatMap((c) => c.tags)));

  // What saving would do, counted from the ticked cases.
  const parts: string[] = [];
  if (priority) {
    const already = cases.filter((c) => c.priority === priority).length;
    parts.push(`priority set to ${PRIORITY_LABEL[priority]} on ${n - already}${already ? ` (${already} already ${already === 1 ? "is" : "are"})` : ""}`);
  }
  if (type) {
    const charters = cases.filter((c) => c.type === "EXPLORATORY").length;
    const already = cases.filter((c) => c.type === type).length;
    parts.push(`type set to ${type === "MANUAL" ? "Manual" : "Automated"} on ${n - already - charters}${charters ? ` (charters keep theirs)` : ""}`);
  }
  if (persona) {
    const id = persona === NO_PERSONA ? null : persona;
    const name = id ? (personas.find((p) => p.id === id)?.name ?? "") : "";
    const changing = cases.filter((c) => (c.personaId ?? null) !== id).length;
    parts.push(id ? `persona set to ${name} on ${changing}` : `persona taken off ${changing}`);
  }
  for (const t of add) parts.push(`tag ${t} added to ${cases.filter((c) => !c.tags.includes(t)).length}`);
  for (const t of remove) parts.push(`tag ${t} removed from ${cases.filter((c) => c.tags.includes(t)).length}`);
  const nothing = parts.length === 0;

  const save = () =>
    start(async () => {
      const res = await editCaseFields(
        projectId,
        cases.map((c) => c.id),
        {
          priority: priority || null,
          type: type || null,
          personaId: persona === KEEP ? undefined : persona === NO_PERSONA ? null : persona,
          addTags: add,
          removeTags: remove,
        },
      );
      if (!res.ok) return setError(res.error);
      onDone(res.count ? `Updated ${plural(res.count)}.` : "Nothing to change. The cases already had those values.");
    });

  return (
    <Modal open onClose={onClose} title={`Edit ${plural(n)}`} wide>
      <div className="space-y-4" data-testid="bulk-edit">
        <p className="text-sm text-slate-600">Only the fields you change are updated. &ldquo;Leave as is&rdquo; keeps each case&apos;s own value.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Priority" htmlFor="be-priority">
            <Select id="be-priority" data-howto="bulk-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
              <option value={KEEP}>Leave as is</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type" htmlFor="be-type">
            <Select id="be-type" value={type} onChange={(e) => setType(e.target.value as "MANUAL" | "AUTOMATED" | "")}>
              <option value={KEEP}>Leave as is</option>
              <option value="MANUAL">Manual</option>
              <option value="AUTOMATED">Automated</option>
            </Select>
          </Field>
          <Field label="Persona" htmlFor="be-persona">
            <Select id="be-persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value={KEEP}>Leave as is</option>
              <option value={NO_PERSONA}>No persona</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TagBox id="be-add" label="Add tags" tags={add} onChange={(t) => (setAdd(t), setRemove((r) => r.filter((x) => !t.includes(x))))} suggestions={knownTags} />
          <TagBox id="be-remove" label="Remove tags" tags={remove} onChange={(t) => (setRemove(t), setAdd((a) => a.filter((x) => !t.includes(x))))} suggestions={tagsOnCases} />
        </div>
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
          {nothing ? "Pick what to change." : `${plural(n)}: ${parts.join(", ")}. Each changed case gets a new version.`}
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || nothing} onClick={save} data-howto="bulk-update">
            {pending ? "Updating…" : `Update ${plural(n)}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Tags as chips: type one and press Enter or a comma. */
function TagBox({ id, label, tags, onChange, suggestions }: { id: string; label: string; tags: string[]; onChange: (tags: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const next = normalizeTags([...tags, ...raw.split(",")]);
    if (next.length !== tags.length) onChange(next);
    setText("");
  };
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-2 py-1">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
            {t}
            <button type="button" aria-label={`Drop ${t}`} className="text-slate-400 hover:text-slate-800" onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <Input
          id={id}
          list={`${id}-list`}
          value={text}
          onChange={(e) => (e.target.value.endsWith(",") ? commit(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (text.trim()) commit(text);
            } else if (e.key === "Backspace" && !text && tags.length) onChange(tags.slice(0, -1));
          }}
          onBlur={() => text.trim() && commit(text)}
          placeholder={tags.length ? "" : "Type a tag, then Enter"}
          className="h-7 min-w-28 flex-1 border-0 px-1 shadow-none focus:ring-0"
        />
        <datalist id={`${id}-list`}>
          {suggestions.filter((s) => !tags.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </Field>
  );
}
