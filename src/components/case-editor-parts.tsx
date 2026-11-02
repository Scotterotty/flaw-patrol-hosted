"use client";

import { TagPill } from "./tag-pill";
import { CloseMatchesLabel } from "./close-matches";
import { forgivingFilter } from "@/lib/fuzzy";
import { tagColor, type TagColors } from "@/lib/tags";
import { useState, useTransition } from "react";
import { missionLine, type Charter } from "@/lib/charter";
import { fillPlaceholders, placeholdersIn, type SharedStepDef } from "@/lib/steps";
import { Modal } from "./modal";
import { Button, cx, ErrorText, Field, Input, Label, Textarea } from "./ui";

export function SharedItem({
  def,
  params,
  onParam,
  projectKey,
  columns = [],
}: {
  def: SharedStepDef | undefined;
  params: Record<string, string>;
  onParam: (name: string, value: string) => void;
  projectKey: string;
  /** Test data columns: a blank with the same name fills in from each row instead. */
  columns?: string[];
}) {
  if (!def)
    return (
      <p className="text-sm text-red-600">
        This shared step no longer exists. Remove it or pick another.
      </p>
    );
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
          Shared
        </span>
        <a
          href={`/p/${projectKey}/shared-steps/${def.id}`}
          target="_blank"
          className="font-medium text-slate-900 hover:underline"
        >
          {fillPlaceholders(def.name, def.parameters, params)}
        </a>
        <span className="text-xs text-slate-400">
          v{def.version} · edits to it update every case using it
        </span>
      </div>
      {def.parameters.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {def.parameters.map((p) =>
            columns.includes(p.name) ? (
              <span
                key={p.name}
                title="Each row of Test data gives this a different value."
                className="inline-flex items-center gap-1 rounded border border-violet-200 px-1.5 text-xs text-violet-700"
              >
                <span className="font-mono">{p.name}</span>: comes from Test data
              </span>
            ) : (
            <label
              key={p.name}
              className="flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span className="font-mono">{p.name}</span>
              <Input
                className="h-7 w-40 text-xs"
                value={params[p.name] ?? ""}
                placeholder={p.defaultValue || "value"}
                onChange={(e) => onParam(p.name, e.target.value)}
              />
            </label>
            ),
          )}
        </div>
      )}
      <ol className="mt-2 space-y-1 border-l-2 border-violet-200 pl-3 text-sm">
        {def.steps.map((s, i) => (
          <li key={i} className="grid gap-1 md:grid-cols-2 wrap-anywhere">
            <span className="min-w-0 text-slate-700">
              {fillPlaceholders(s.action, def.parameters, params)}
            </span>
            <span className="min-w-0 text-slate-500">
              {fillPlaceholders(s.expected, def.parameters, params)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SharedPicker({
  open,
  defs,
  at,
  count,
  onClose,
  onPick,
}: {
  open: boolean;
  defs: SharedStepDef[];
  /** Where the steps go: before item `at`, so 0 is the start and `count` the end. */
  at: number;
  count: number;
  onClose: () => void;
  onPick: (d: SharedStepDef, params: Record<string, string>) => void;
}) {
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // Forgiving search: exact matches, then close ones under their own label.
  const found = forgivingFilter(defs, q, (d) => d.name);
  const shown = [...found.exact, ...found.close];
  const closeStart = found.close.length ? found.exact.length : -1;
  const picked = shown.find((d) => d.id === pickedId) ?? shown[0];
  const where =
    count === 0 ? "" : at >= count ? " at the end" : at === 0 ? " at the start" : ` after step ${at}`;
  const choose = (d: SharedStepDef) => {
    setPickedId(d.id);
    setValues(Object.fromEntries(d.parameters.map((p) => [p.name, p.defaultValue ?? ""])));
  };
  const close = () => {
    setQ("");
    setPickedId(null);
    onClose();
  };
  const params = picked
    ? Object.fromEntries(picked.parameters.map((p) => [p.name, pickedId === picked.id ? (values[p.name] ?? "") : (p.defaultValue ?? "")]))
    : {};
  return (
    <Modal open={open} onClose={close} title="Insert shared step" wide>
      <Input
        autoFocus
        placeholder="Search shared steps"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto" aria-label="Shared steps">
          {shown.map((d, i) => (
            <li key={d.id}>
              {i === closeStart && (
                <>
                  {closeStart === 0 && <p className="px-2 pt-1.5 text-xs text-slate-500">No exact matches.</p>}
                  <CloseMatchesLabel className="px-1" />
                </>
              )}
              <button
                type="button"
                aria-pressed={picked?.id === d.id}
                className={cx(
                  "w-full rounded px-2 py-2 text-left",
                  picked?.id === d.id ? "bg-violet-50 ring-1 ring-violet-300" : "hover:bg-slate-50",
                )}
                onClick={() => choose(d)}
              >
                <span className="block font-medium text-slate-900">{d.name}</span>
                <span className="text-xs text-slate-500">
                  {d.steps.length} {d.steps.length === 1 ? "step" : "steps"}
                  {d.usedIn !== undefined && ` · in ${d.usedIn} ${d.usedIn === 1 ? "case" : "cases"}`}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="py-4 text-center text-sm text-slate-500">
              No shared steps match.
            </li>
          )}
        </ul>
        {picked && (
          <div className="rounded-md border border-violet-200 bg-violet-50/40 p-3" aria-label="Preview">
            <p className="text-sm font-semibold text-slate-900">
              {fillPlaceholders(picked.name, picked.parameters, params)}{" "}
              <span className="text-xs font-normal text-slate-500">v{picked.version}</span>
            </p>
            <ol className="mt-2 space-y-1 text-sm">
              {picked.steps.map((s, i) => (
                <li key={i} className="wrap-anywhere text-slate-700">
                  {i + 1}. {fillPlaceholders(s.action, picked.parameters, params)}
                  {s.expected && (
                    <span className="block pl-4 text-xs text-slate-500">
                      {fillPlaceholders(s.expected, picked.parameters, params)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {picked.parameters.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {picked.parameters.map((p) => (
                  <label key={p.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="font-mono">{p.name}</span>
                    <Input
                      className="h-7 w-36 text-xs"
                      value={params[p.name] ?? ""}
                      placeholder="value"
                      onChange={(e) => {
                        if (pickedId !== picked.id) setPickedId(picked.id);
                        setValues({ ...params, [p.name]: e.target.value });
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  onPick(picked, params);
                  setQ("");
                  setPickedId(null);
                }}
              >
                Add {picked.steps.length} {picked.steps.length === 1 ? "step" : "steps"}
                {where}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ConvertDialog({
  open,
  steps,
  onClose,
  onCreate,
}: {
  open: boolean;
  steps: { action: string; expected: string }[];
  onClose: () => void;
  onCreate: (name: string, values: Record<string, string>) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  // Each {{parameter}} gets this case's value here, so the case doesn't show a raw {{user}}.
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const params = placeholdersIn(steps);
  return (
    <Modal open={open} onClose={onClose} title="Make a shared step">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {steps.length === 1 ? "The 1 selected step becomes" : `The ${steps.length} selected steps become`} a reusable block, and this
          case will use it in {steps.length === 1 ? "its" : "their"} place. Other cases can insert it too.
        </p>
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <Field label="Name" htmlFor="sname">
          <Input
            id="sname"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Log in as admin"
          />
        </Field>
        {params.length ? (
          <div className="space-y-2">
            {params.map((p) => (
              <Field key={p} label={`Value of ${p} for this case`} htmlFor={`sparam-${p}`}>
                <Input id={`sparam-${p}`} value={values[p] ?? ""} onChange={(e) => setValues({ ...values, [p]: e.target.value })} placeholder="value" />
              </Field>
            ))}
            <p className="text-xs text-slate-500">Other cases fill in their own values when they insert it.</p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Tip: write {"{{name}}"} in a step, like {"{{role}}"}, to make it a parameter each case fills in. You can add these later.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={pending || !name.trim()}
            onClick={() =>
              start(async () => {
                const err = await onCreate(name.trim(), values);
                setError(err);
                if (!err) {
                  setName("");
                  setValues({});
                }
              })
            }
          >
            Create shared step
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function TagInput({
  tags,
  known,
  onChange,
  colors,
}: {
  colors?: TagColors;
  tags: string[];
  known: string[];
  onChange: (t: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length) onChange([...new Set([...tags, ...parts])]);
    setDraft("");
  };
  return (
    <div>
      <Label htmlFor="tags">Tags</Label>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-surface px-1.5 py-1 shadow-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
        {tags.map((t) => (
          <TagPill key={t} tag={t} color={tagColor(t, colors)}>
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              ×
            </button>
          </TagPill>
        ))}
        <input
          id="tags"
          list="known-tags"
          value={draft}
          placeholder={tags.length ? "" : "smoke, checkout"}
          className="min-w-24 flex-1 border-0 bg-transparent px-1 text-sm outline-none"
          onChange={(e) => {
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
            if (e.key === "Backspace" && !draft && tags.length)
              onChange(tags.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
        />
        <datalist id="known-tags">
          {known
            .filter((k) => !tags.includes(k))
            .map((k) => (
              <option key={k} value={k} />
            ))}
        </datalist>
      </div>
    </div>
  );
}

export function SmallBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-6 w-6 rounded text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-800 disabled:invisible"
    >
      {children}
    </button>
  );
}

export const NEW_PERSONA = "__new";

/** Prompts: things to try, ticked in the session. Tours and checklists fill them in. */
export function PromptRows({ prompts, onChange }: { prompts: string[]; onChange: (p: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || prompts.length >= 30) return;
    onChange([...prompts, v]);
    setDraft("");
  };
  return (
    <section aria-label="Prompts" className="mt-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">Prompts</h2>
      <p className="text-xs text-slate-500">Optional. Things to try, ticked off during the session.</p>
      {prompts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {prompts.map((p, i) => (
            <li key={`${i}-${p}`} className="flex items-center gap-2">
              <span aria-hidden className="text-slate-400">☐</span>
              <Input aria-label={`Prompt ${i + 1}`} className="h-8" value={p} onChange={(e) => onChange(prompts.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => !p.trim() && onChange(prompts.filter((_, j) => j !== i))} />
              <Button size="sm" variant="ghost" aria-label={`Remove prompt ${i + 1}`} onClick={() => onChange(prompts.filter((_, j) => j !== i))}>
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex gap-2">
        <Input
          aria-label="New prompt"
          className="h-8"
          placeholder="Add a prompt, like “Lose the network mid-save”"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </section>
  );
}

/** A charter's mission, written as "Explore … with … to discover …". */
export function CharterFields({
  charter,
  onChange,
}: {
  charter: Charter;
  onChange: <K extends keyof Charter>(k: K, v: Charter[K]) => void;
}) {
  const line = missionLine(charter);
  return (
    <div className="mt-6 space-y-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Mission</h2>
        <p className="text-xs text-slate-500">
          Shown beside the timer while people explore.
        </p>
      </div>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">What to explore</h3>
      <Field
        label="Explore"
        htmlFor="charter-explore"
        hint="The area, feature or screens"
      >
        <Textarea
          id="charter-explore"
          rows={2}
          value={charter.explore}
          onChange={(e) => onChange("explore", e.target.value)}
          placeholder="checkout and the payment screens"
        />
      </Field>
      <Field
        label="With"
        htmlFor="charter-with"
        hint="Tools, data, settings or tricks to use"
      >
        <Textarea
          id="charter-with"
          rows={2}
          value={charter.with}
          onChange={(e) => onChange("with", e.target.value)}
          placeholder="network throttling and airplane mode mid-payment"
        />
      </Field>
      <h3 className="border-t border-slate-100 pt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">What you&apos;re looking for</h3>
      <Field
        label="To discover"
        htmlFor="charter-discover"
        hint="What you hope to learn"
      >
        <Textarea
          id="charter-discover"
          rows={2}
          value={charter.discover}
          onChange={(e) => onChange("discover", e.target.value)}
          placeholder="how payments recover when the network drops"
        />
      </Field>
      {line && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="text-xs font-medium text-slate-500">Reads as: </span>
          {line}
        </p>
      )}
    </div>
  );
}
