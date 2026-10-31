"use client";

// Settings → Bug templates (ver_119): the list, New template, and the editor with a live preview.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  blankLayout,
  blankSection,
  canMust,
  COLUMN_FILLS,
  layoutTitle,
  readyMadeLayout,
  SOURCES,
  type BugLayout,
  type ColumnFill,
  type Section,
  type Source,
} from "@/lib/bug-layout";
import type { CurrentLayout, TemplateRow } from "@/lib/bug-templates-data";
import { deleteBugTemplate, duplicateBugTemplate, saveBugTemplate, setDefaultBugTemplate } from "@/server/bug-templates";
import { readBugLayout } from "@/server/jira";
import { Modal } from "./modal";
import { Button, cx, ErrorText, InfoTip, Input, Select } from "./ui";

type Props = {
  projectId: string;
  current: CurrentLayout;
  templates: TemplateRow[];
  defaultId: string;
  canEdit: boolean;
  canDelete: boolean;
  jiraConnected: boolean;
  /** Where the current layout is changed (Settings → Jira bug layout). */
  currentHref: string | null;
};

const item = "block w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50";

export function BugTemplatesSettings({ projectId, current, templates, defaultId, canEdit, canDelete, jiraConnected, currentHref }: Props) {
  const router = useRouter();
  const [menu, setMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState<{ id?: string; name: string; hint: string; layout: BugLayout } | null>(null);
  const [starting, setStarting] = useState(false);
  const [renaming, setRenaming] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      setError(null);
      setMenu(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
      else router.refresh();
    });

  const rows = [{ id: "", name: current.name, hint: "", sub: current.kind === "plain" ? "Summary and Severity, with the steps filled in for you" : "Set in the Jira bug layout row" }, ...templates.map((t) => ({ id: t.id, name: t.name, hint: t.hint, sub: summaryOf(t.layout) }))];

  return (
    <div className="space-y-3" data-testid="bug-templates">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-slate-600">
          People pick one of these when they report a bug. <InfoTip text="The default is already picked for them, and they can switch. Bugs already reported keep their layout when a template changes." />
        </p>
        {canEdit && (
          <Button variant="primary" size="sm" onClick={() => setStarting(true)}>
            New template
          </Button>
        )}
      </div>
      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {rows.map((r) => {
          const t = templates.find((x) => x.id === r.id);
          return (
            <li key={r.id || "current"} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-testid="bug-template-row">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {r.name}{" "}
                  {r.id === defaultId && <span className="ml-1 rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">Default</span>}
                  {!r.id && <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Current layout</span>}
                </p>
                <p className="text-xs text-slate-500">{[r.hint, r.sub].filter(Boolean).join(" · ")}</p>
              </div>
              {t && canEdit && (
                <Button size="sm" onClick={() => setEditing({ id: t.id, name: t.name, hint: t.hint, layout: t.layout })}>
                  Edit…
                </Button>
              )}
              {(canEdit || (!r.id && currentHref)) && (
                <span className="relative inline-block" ref={menu === (r.id || "current") ? menuRef : undefined}>
                  <Button size="sm" aria-haspopup="menu" aria-expanded={menu === (r.id || "current")} aria-label={`More for ${r.name}`} onClick={() => setMenu(menu === (r.id || "current") ? null : r.id || "current")}>
                    ⋯
                  </Button>
                  {menu === (r.id || "current") && (
                    <div role="menu" className="absolute top-full right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-surface p-1 text-left shadow-lg">
                      {canEdit && r.id !== defaultId && (
                        <button type="button" role="menuitem" className={item} disabled={pending} onClick={() => run(() => setDefaultBugTemplate(projectId, r.id))}>
                          Make default
                        </button>
                      )}
                      {!r.id && currentHref && (
                        <a role="menuitem" className={item} href={currentHref} onClick={() => setMenu(null)}>
                          Change the Jira bug layout
                        </a>
                      )}
                      {t && canEdit && (
                        <>
                          <button type="button" role="menuitem" className={item} disabled={pending} onClick={() => run(() => duplicateBugTemplate(projectId, t.id))}>
                            Duplicate
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={item}
                            onClick={() => {
                              setMenu(null);
                              setRenaming(t);
                            }}
                          >
                            Rename…
                          </button>
                          <div className="my-1 h-px bg-slate-100" />
                          <button
                            type="button"
                            role="menuitem"
                            className={item}
                            disabled={!canDelete}
                            title={canDelete ? undefined : "Only Admins can delete a template. Bugs already reported keep their layout."}
                            onClick={() => {
                              setMenu(null);
                              setDeleting(t);
                            }}
                          >
                            Delete…
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {starting && (
        <NewTemplate
          projectId={projectId}
          templates={templates}
          jiraConnected={jiraConnected}
          onClose={() => setStarting(false)}
          onNext={(name, layout) => {
            setStarting(false);
            setEditing({ name, hint: "", layout });
          }}
        />
      )}
      {editing && (
        <TemplateEditor
          projectId={projectId}
          initial={editing}
          others={[current.name, ...templates.filter((t) => t.id !== editing.id).map((t) => t.name)]}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
      {renaming && (
        <RenameTemplate
          t={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            const t = renaming;
            setRenaming(null);
            run(() => saveBugTemplate(projectId, { id: t.id, name, hint: t.hint, layout: t.layout }));
          }}
        />
      )}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? ""}?`}>
        <p className="text-sm text-slate-700">People won&apos;t be able to pick it anymore. Bugs already reported with it keep their layout.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              const t = deleting!;
              setDeleting(null);
              run(() => deleteBugTemplate(projectId, t.id));
            }}
          >
            Delete template
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** "5 headings · a table · asks for a file": what a template has, in a few words. */
function summaryOf(l: BugLayout) {
  const live = l.sections.filter((s) => s.source !== "empty");
  const bits = [`${live.length} ${live.length === 1 ? "heading" : "headings"}`];
  if (live.some((s) => s.source === "table")) bits.push("a table");
  if (live.some((s) => s.source === "file")) bits.push("asks for a file");
  if (l.shot) bits.push("screenshot needed");
  if (l.fields.length) bits.push(`${l.fields.length} Jira ${l.fields.length === 1 ? "field" : "fields"} from ${l.from || "Jira"}`);
  return bits.join(" · ");
}

function RenameTemplate({ t, onClose, onSave }: { t: TemplateRow; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(t.name);
  return (
    <Modal open onClose={onClose} title={`Rename ${t.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <label className="block text-sm font-medium text-slate-700" htmlFor="bt-rename">
          Name
        </label>
        <Input id="bt-rename" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewTemplate({
  projectId,
  templates,
  jiraConnected,
  onClose,
  onNext,
}: {
  projectId: string;
  templates: TemplateRow[];
  jiraConnected: boolean;
  onClose: () => void;
  onNext: (name: string, layout: BugLayout) => void;
}) {
  const [from, setFrom] = useState<"blank" | "copy" | "jira" | "readymade">("blank");
  const [copyId, setCopyId] = useState(templates[0]?.id ?? "");
  const [example, setExample] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const opt = (v: typeof from, label: string, extra?: React.ReactNode, disabled = false, tip?: string) => (
    <label className={cx("flex items-center gap-2 text-sm", disabled ? "text-slate-400" : "text-slate-800")}>
      <input type="radio" name="bt-from" checked={from === v} disabled={disabled} onChange={() => setFrom(v)} />
      {label}
      {tip && <InfoTip text={tip} />}
      {extra}
    </label>
  );
  return (
    <Modal open onClose={onClose} title="New template">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            if (from === "blank") return onNext(name.trim(), blankLayout());
            if (from === "readymade") return onNext(name.trim(), readyMadeLayout());
            if (from === "copy") {
              const t = templates.find((x) => x.id === copyId);
              return t ? onNext(name.trim(), structuredClone(t.layout)) : setError("Pick a template to copy.");
            }
            const res = await readBugLayout(projectId, example);
            return res.ok ? onNext(name.trim(), res.layout) : setError(res.error);
          });
        }}
      >
        <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
        <fieldset className="space-y-2">
          <legend className="sr-only">Start from</legend>
          {opt("blank", "Start blank")}
          {opt(
            "copy",
            "Copy one of these templates",
            from === "copy" && templates.length > 0 && (
              <Select aria-label="Template to copy" value={copyId} onChange={(e) => setCopyId(e.target.value)} className="ml-1 w-auto">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            ),
            templates.length === 0,
            templates.length === 0 ? "There are no templates to copy yet." : undefined,
          )}
          {opt(
            "jira",
            "Copy a Jira bug's layout",
            from === "jira" && <Input aria-label="Jira bug key or link" placeholder="Bug key or link, like QA-418" value={example} onChange={(e) => setExample(e.target.value)} className="ml-1 w-56" />,
            !jiraConnected,
            jiraConnected ? "Paste a bug key like QA-418. Flaw Patrol reads its title, headings and fields." : "Needs Jira to be connected.",
          )}
          {opt("readymade", "The ready-made detailed layout", undefined, false, "Headings like Issue observed on and Bug impact, and a Reproduction history table.")}
        </fieldset>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="bt-new-name">
            Name
          </label>
          <Input id="bt-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Crash or freeze" maxLength={80} required />
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim() || (from === "jira" && !example.trim())}>
            {pending ? "Reading…" : "Next"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const EXAMPLE = {
  steps: "1. Add any item to the cart\n2. Open Checkout\n3. Tap Pay",
  expected: "The payment screen opens.",
  actual: "The app closed with no message.",
  env: "Release 4.2 · Build 4.2.0-118 · Staging",
};
const EXAMPLE_CELLS: Record<ColumnFill, string> = { now: "Oct 31, 2026, 6:14 PM PDT", build: "4.2.0-118", env: "Staging", device: "Chrome 141 · Windows", who: "Sam Lee", files: "pay-crash.png", write: "" };

export function TemplateEditor({
  projectId,
  initial,
  others,
  onClose,
  onSaved,
}: {
  projectId: string;
  initial: { id?: string; name: string; hint: string; layout: BugLayout };
  others: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [hint, setHint] = useState(initial.hint);
  const [layout, setLayout] = useState<BugLayout>(initial.layout);
  const [view, setView] = useState<"form" | "bug">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setSec = (i: number, patch: Partial<Section>) => setLayout((l) => ({ ...l, sections: l.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setLayout((l) => {
      const s = [...l.sections];
      [s[i], s[i + d]] = [s[i + d], s[i]];
      return { ...l, sections: s };
    });
  const clash = others.some((o) => o.trim().toLowerCase() === name.trim().toLowerCase());

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveBugTemplate(projectId, { id: initial.id, name, hint, layout });
      if (res.ok) onSaved();
      else setError(res.error);
    });

  return (
    <Modal open onClose={onClose} title={initial.id ? `Edit ${initial.name}` : `New template: ${initial.name}`} wide>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" data-testid="template-editor">
        <div className="min-w-0 space-y-4">
          <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bt-name">
                Name
              </label>
              <Input id="bt-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              {clash && <p className="mt-1 text-xs text-amber-800">Another template already has this name.</p>}
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                <label htmlFor="bt-hint">When to use it</label>
                <InfoTip text="Shown under the name when someone picks a template." />
              </div>
              <Input id="bt-hint" value={hint} onChange={(e) => setHint(e.target.value)} maxLength={160} placeholder="The app closed, froze or showed an error" />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
              Title <InfoTip text="[Platform] comes from the run's [bracket] tag, like [Windows]. Area comes from the last part of the test case's name." />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
              {(
                [
                  ["platform", "[Platform]"],
                  ["area", "Area"],
                  ["build", "Build number"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={layout.title[k]} onChange={(e) => setLayout((l) => ({ ...l, title: { ...l.title, [k]: e.target.checked } }))} />
                  {label}
                </label>
              ))}
              <span className="text-slate-500">+ Summary</span>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-600">
              Headings{" "}
              <InfoTip text="Use the arrows to change the order. Pick where each heading's text comes from. When a bug isn't from a test step (like an exploring session), headings that fill in from the step become text boxes instead." />
            </div>
            <ol className="divide-y divide-slate-100">
              {layout.sections.map((s, i) => (
                <li key={s.id} className="space-y-1.5 py-2" data-testid="template-heading">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,13rem)_auto]">
                    <span className="flex flex-col">
                      <button type="button" className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${s.heading} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        ▲
                      </button>
                      <button
                        type="button"
                        className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        aria-label={`Move ${s.heading} down`}
                        disabled={i === layout.sections.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        ▼
                      </button>
                    </span>
                    <Input aria-label="Heading name" value={s.heading} onChange={(e) => setSec(i, { heading: e.target.value })} maxLength={120} />
                    <Select
                      aria-label={`Where ${s.heading || "this heading"}'s text comes from`}
                      className="col-start-2 sm:col-start-auto"
                      value={s.source}
                      onChange={(e) => {
                        const source = e.target.value as Source;
                        const fresh = blankSection(source, s.heading);
                        setSec(i, {
                          source,
                          must: canMust(source) && s.must,
                          choices: source === "choice" && s.choices.length < 2 ? fresh.choices : s.choices,
                          columns: source === "table" && !s.columns.length ? fresh.columns : s.columns,
                          growing: source === "table" ? (s.columns.length ? s.growing : true) : s.growing,
                        });
                      }}
                    >
                      {Object.entries(SOURCES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="row-start-1 rounded px-1.5 text-base text-slate-500 hover:bg-slate-100 sm:col-start-4 sm:row-start-auto"
                      aria-label={`Remove ${s.heading}`}
                      onClick={() => setLayout((l) => ({ ...l, sections: l.sections.filter((_, j) => j !== i) }))}
                    >
                      ×
                    </button>
                  </div>
                  <SectionExtras s={s} set={(patch) => setSec(i, patch)} />
                </li>
              ))}
            </ol>
            <Button size="sm" className="mt-1" onClick={() => setLayout((l) => ({ ...l, sections: [...l.sections, blankSection("text")] }))}>
              + Add heading
            </Button>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Must have before reporting</p>
            <div className="flex flex-wrap gap-3 text-sm text-slate-700">
              {layout.sections
                .map((s, i) => [s, i] as const)
                .filter(([s]) => canMust(s.source))
                .map(([s, i]) => (
                  <label key={s.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={s.must} onChange={(e) => setSec(i, { must: e.target.checked })} />
                    {s.heading || "Untitled"}
                  </label>
                ))}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={layout.shot} onChange={(e) => setLayout((l) => ({ ...l, shot: e.target.checked }))} />A screenshot or video
              </label>
            </div>
          </div>
          {layout.fields.length > 0 && (
            <p className="text-xs text-slate-500">
              Jira fields from {layout.from || "Jira"}: {layout.fields.map((f) => f.name).join(", ")}.{" "}
              <InfoTip text="They're filled in the same way as the layout they came from. Only shown when Jira is connected." />
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-sm" role="tablist">
            {(["form", "bug"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("flex-1 rounded px-3 py-1", view === v ? "bg-surface font-medium shadow-sm" : "text-slate-600")}>
                {v === "form" ? "The form" : "The finished bug"}
              </button>
            ))}
          </div>
          <Preview name={name} hint={hint} layout={layout} view={view} />
          <p className="text-xs text-slate-500">Example data. Headings set to Leave out don&apos;t appear.</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={pending || !name.trim() || clash} onClick={save}>
          {pending ? "Saving…" : "Save template"}
        </Button>
      </div>
    </Modal>
  );
}

/** The settings under a heading that only some kinds have: hint, choices, file types, table columns. */
function SectionExtras({ s, set }: { s: Section; set: (patch: Partial<Section>) => void }) {
  if (s.source === "text")
    return <Input aria-label={`Hint inside the ${s.heading} box`} value={s.hint} onChange={(e) => set({ hint: e.target.value })} placeholder="Hint inside the box (optional), like: Paste the crash log" className="text-sm" />;
  if (s.source === "choice")
    return (
      <Input
        aria-label={`Choices for ${s.heading}`}
        value={s.choices.join(", ")}
        onChange={(e) => set({ choices: e.target.value.split(",").map((c) => c.trimStart()) })}
        onBlur={() => set({ choices: s.choices.map((c) => c.trim()).filter(Boolean) })}
        placeholder="Choices, separated by commas"
        className="text-sm"
      />
    );
  if (s.source === "file")
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label={`File types for ${s.heading}`} value={s.types} onChange={(e) => set({ types: e.target.value })} placeholder="File types, like .txt, .log (blank = any)" className="w-64 text-sm" />
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={s.paste} onChange={(e) => set({ paste: e.target.checked })} />
          Or paste the text instead
        </label>
      </div>
    );
  if (s.source === "table")
    return (
      <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
        {s.columns.map((c, j) => (
          <div key={j} className="grid grid-cols-[minmax(0,1fr)_minmax(0,13rem)_auto] items-center gap-1.5">
            <Input aria-label="Column name" value={c.name} onChange={(e) => set({ columns: s.columns.map((x, k) => (k === j ? { ...x, name: e.target.value } : x)) })} className="text-sm" />
            <Select aria-label={`What goes in ${c.name || "this column"}`} value={c.fill} onChange={(e) => set({ columns: s.columns.map((x, k) => (k === j ? { ...x, fill: e.target.value as ColumnFill } : x)) })} className="text-sm">
              {Object.entries(COLUMN_FILLS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <button type="button" className="rounded px-1.5 text-slate-500 hover:bg-slate-200" aria-label={`Remove column ${c.name}`} onClick={() => set({ columns: s.columns.filter((_, k) => k !== j) })}>
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={s.columns.length >= 12} onClick={() => set({ columns: [...s.columns, { name: "New column", fill: "write" }] })}>
            + Add column
          </Button>
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={s.growing} onChange={(e) => set({ growing: e.target.checked })} />
            Add a row each time someone sees it again
            <InfoTip text="The bug gets an I saw it again button. It adds a row instead of a new bug, and the automatic columns fill in on their own." />
          </label>
        </div>
      </div>
    );
  return null;
}

function PreviewTable({ s, rows }: { s: Section; rows: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-slate-200 bg-surface text-[11px]">
        <thead>
          <tr>
            {s.columns.map((c, i) => (
              <th key={i} className="border-r border-slate-100 bg-slate-100 px-1.5 py-1 text-left font-semibold whitespace-nowrap">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {s.columns.map((c, i) => (
                <td key={i} className={cx("border-t border-r border-slate-100 px-1.5 py-1 whitespace-nowrap", c.fill !== "write" && "bg-slate-50 text-slate-500")}>
                  {c.fill === "write" ? <span className="inline-block min-w-10 rounded border border-slate-300 px-1">&nbsp;</span> : r ? EXAMPLE_CELLS[c.fill].replace("Sam Lee", "Ana Ruiz") : EXAMPLE_CELLS[c.fill]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ name, hint, layout, view }: { name: string; hint: string; layout: BugLayout; view: "form" | "bug" }) {
  const live = layout.sections.filter((s) => s.source !== "empty" && s.heading.trim());
  const title = layoutTitle(layout.title, { platform: "Windows", area: "Checkout", build: "4.2.0-118", summary: "App closes when tapping Pay" });
  if (view === "bug")
    return (
      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-[13px]" data-testid="template-preview-bug">
        <p className="font-semibold text-slate-900">{title}</p>
        {live.map((s) => (
          <div key={s.id}>
            <p className="font-semibold text-slate-800">{s.heading}</p>
            {s.source === "table" ? (
              <PreviewTable s={s} rows={s.growing ? 2 : 1} />
            ) : s.source === "file" ? (
              <p className="text-accent-700 underline">{`${s.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file"}${(s.types.split(/[\s,]+/).find(Boolean) ?? ".txt").replace(/^\.?/, ".")}`}</p>
            ) : (
              <p className="whitespace-pre-wrap text-slate-700">
                {s.source in EXAMPLE ? EXAMPLE[s.source as keyof typeof EXAMPLE] : s.source === "choice" ? (s.choices[0] ?? "") : "(What the person wrote in the box)"}
              </p>
            )}
          </div>
        ))}
        {!live.length && <p className="text-slate-500">Add a heading to see it here.</p>}
      </div>
    );
  const auto = live.filter((s) => s.source !== "actual" && s.source in EXAMPLE).map((s) => s.heading);
  const need = live.filter((s) => s.must && (s.source === "text" || s.source === "file")).map((s) => s.heading);
  return (
    <div className="space-y-2.5 rounded-lg bg-slate-50 p-3 text-[13px]" data-testid="template-preview-form">
      <div>
        <p className="text-xs font-semibold text-slate-700">Template</p>
        <span className="inline-block rounded-full bg-accent-600 px-2.5 py-0.5 text-xs text-white">{name || "Untitled template"}</span>
        {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-700">Title</p>
        <p className="rounded border border-slate-200 bg-surface px-2 py-1">{title}</p>
      </div>
      {live
        .filter((s) => !(s.source in EXAMPLE) || s.source === "actual")
        .map((s) => (
          <div key={s.id}>
            <p className="text-xs font-semibold text-slate-700">
              {s.heading} {s.must && <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[11px] text-amber-800">Needed</span>}
            </p>
            {s.source === "actual" ? (
              <p className="rounded border border-slate-200 bg-surface px-2 py-1">{EXAMPLE.actual}</p>
            ) : s.source === "choice" ? (
              <div className="flex flex-wrap gap-1">
                {s.choices.filter(Boolean).map((c, i) => (
                  <span key={i} className={cx("rounded-full border px-2 py-0.5 text-xs", i === 0 ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface")}>
                    {c}
                  </span>
                ))}
              </div>
            ) : s.source === "table" ? (
              <PreviewTable s={s} rows={1} />
            ) : s.source === "file" ? (
              <div className="rounded border border-dashed border-slate-300 bg-surface px-2 py-2 text-xs text-slate-500">
                Choose file, or drop {s.types.trim() ? `a ${s.types.split(/[\s,]+/).filter(Boolean).join(" or ")}` : "any"} file here{s.paste ? " · or paste the text instead" : ""}
              </div>
            ) : (
              <p className="min-h-12 rounded border border-slate-200 bg-surface px-2 py-1 text-slate-400">{s.hint || "Write here"}</p>
            )}
          </div>
        ))}
      {auto.length > 0 && <p className="text-xs text-slate-500">{auto.join(", ")} fill in from the run.</p>}
      <div className="flex items-center justify-end gap-2">
        {(need.length > 0 || layout.shot) && <span className="text-xs text-amber-800">Add {[...need, ...(layout.shot ? ["a screenshot or video"] : [])].join(" and ")} to report it</span>}
        <span className={cx("rounded-md bg-accent-600 px-3 py-1 text-xs text-white", (need.length > 0 || layout.shot) && "opacity-50")}>Report bug</span>
      </div>
    </div>
  );
}
