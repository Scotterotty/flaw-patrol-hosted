"use client";

import { TagPill, TagPills } from "./tag-pill";
import { tagColor, type TagColors } from "@/lib/tags";
import type { CaseType, Priority } from "@prisma/client";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { PersonaForm } from "./personas";
import {
  BLANK_CHARTER,
  missionLine,
  TIME_BOXES,
  type Charter,
} from "@/lib/charter";
import { ReminderRows } from "./reminders";
import { caseKey, PRIORITIES, PRIORITY_LABEL } from "@/lib/format";
import {
  fillPlaceholders,
  placeholdersIn,
  type CaseStepItem,
  type SharedStepDef,
} from "@/lib/steps";
import { saveCase } from "@/server/cases";
import { saveSharedStep } from "@/server/shared-steps";
import { Modal } from "./modal";
import {
  Button,
  cx,
  ErrorText,
  Field,
  Input,
  Label,
  Select,
  Textarea,
} from "./ui";

type Item = CaseStepItem & { uid: string };

export type CaseEditorProps = {
  projectId: string;
  projectKey: string;
  caseId: string | null;
  number: number | null;
  version: number | null;
  initial: {
    title: string;
    preconditions: string;
    priority: Priority;
    type: CaseType;
    automationId: string | null;
    tags: string[];
    folderId: string | null;
    steps: CaseStepItem[];
    /** Set for charters (type EXPLORATORY), which have a mission instead of steps. */
    charter: Charter | null;
    personaId: string | null;
  };
  personas: { id: string; name: string; emoji: string }[];
  folderOptions: { id: string; label: string }[];
  sharedSteps: SharedStepDef[];
  knownTags: string[];
  canManageShared: boolean;
  /** Editing in an umbrella's Case library rather than a test cycle (ver_89 wording). */
  inLibrary?: boolean;
  /** Shown under the tags, e.g. the Jira stories field (which saves on its own). */
  extra?: React.ReactNode;
  /** Tag pill colors and the umbrella's platform names, so [WEB] becomes Web (ver_96). */
  tagColors?: TagColors;
  platformNames?: string[];
};

let uidCounter = 0;
const uid = () => `i${++uidCounter}`;
const withUid = (s: CaseStepItem): Item => ({ ...s, uid: uid() });
const blankStep = (): Item => ({
  kind: "step",
  action: "",
  expected: "",
  uid: uid(),
});
const stripUid = ({ uid: _uid, ...rest }: Item): CaseStepItem => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

export function CaseEditor(props: CaseEditorProps) {
  const { projectId, projectKey, caseId, number, initial } = props;
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const justTagged = useRef(false);
  const [preconditions, setPreconditions] = useState(initial.preconditions);
  const [priority, setPriority] = useState<Priority>(initial.priority);
  const [type, setType] = useState<CaseType>(initial.type);
  const [automationId, setAutomationId] = useState(initial.automationId ?? "");
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [folderId, setFolderId] = useState(initial.folderId ?? "");
  // Initial ids come from position so the server and browser render the same; added steps use the counter.
  const [items, setItems] = useState<Item[]>(() =>
    initial.steps.length
      ? initial.steps.map((st, i) => ({ ...st, uid: `s${i}` }))
      : [{ kind: "step", action: "", expected: "", uid: "s0" }],
  );
  const [changeNote, setChangeNote] = useState("");
  const isCharter = type === "EXPLORATORY";
  const [charter, setCharter] = useState<Charter>(
    initial.charter ?? BLANK_CHARTER,
  );
  const [personaId, setPersonaId] = useState(initial.personaId ?? "");
  const [personas, setPersonas] = useState(props.personas);
  const [addingPersona, setAddingPersona] = useState(false);
  const setCharterField = <K extends keyof Charter>(k: K, v: Charter[K]) => {
    setCharter((c) => ({ ...c, [k]: v }));
    touch();
  };
  const [defs, setDefs] = useState(
    () => new Map(props.sharedSteps.map((d) => [d.id, d])),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ at: number } | null>(null);
  // What the last insert did, said out loud, and the inserted block glows for a moment.
  const [added, setAdded] = useState<{ text: string } | null>(null);
  const [glow, setGlow] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const focusUid = useRef<string | null>(null);
  // After Create and new: the case just made, so it can be opened.
  const [made, setMade] = useState<{ number: number; title: string } | null>(null);
  // Type, automation ID and persona fold away unless a case already uses one.
  const [moreFields, setMoreFields] = useState(initial.type === "AUTOMATED" || !!initial.automationId || !!initial.personaId);

  const touch = () => setDirty(true);
  const update = (fn: (prev: Item[]) => Item[]) => {
    setItems(fn);
    touch();
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!focusUid.current) return;
    document
      .querySelector<HTMLTextAreaElement>(
        `[data-uid="${focusUid.current}"] textarea`,
      )
      ?.focus();
    focusUid.current = null;
  });

  const save = useCallback((andNew = false) => {
    setError(null);
    start(async () => {
      const res = await saveCase(projectId, caseId, {
        title,
        preconditions,
        priority,
        type,
        automationId: automationId.trim() || null,
        tags,
        folderId: folderId || null,
        steps: isCharter ? [] : items.map(stripUid),
        charter: isCharter ? charter : null,
        personaId: personaId || null,
        changeNote,
      });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      if (andNew && !caseId) {
        // Keep folder, priority, type, tags and persona; start the next case blank.
        setMade({ number: res.number, title });
        setTitle("");
        setPreconditions("");
        setAutomationId("");
        setItems([blankStep()]);
        setCharter((c) => ({ ...BLANK_CHARTER, minutes: c.minutes }));
        setSelected(new Set());
        document.getElementById("title")?.focus();
        router.refresh();
        return;
      }
      router.push(`/p/${projectKey}/cases/${res.number}`);
      router.refresh();
    });
  }, [
    projectId,
    caseId,
    title,
    preconditions,
    priority,
    type,
    automationId,
    tags,
    folderId,
    items,
    changeNote,
    projectKey,
    router,
    isCharter,
    charter,
    personaId,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const insertStepAfter = (index: number) => {
    const s = blankStep();
    focusUid.current = s.uid;
    update((prev) => [
      ...prev.slice(0, index + 1),
      s,
      ...prev.slice(index + 1),
    ]);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    update((prev) => {
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const numbering = useMemo(() => items.map((_, i) => String(i + 1)), [items]);
  const selectedPlain = items.filter(
    (i) => i.kind === "step" && selected.has(i.uid),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="mx-auto max-w-4xl"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {caseId && number ? (
            <>
              <span className="font-mono text-base text-slate-500">
                {caseKey(projectKey, number)}
              </span>{" "}
              {isCharter ? "Edit charter" : "Edit case"}
            </>
          ) : isCharter ? (
            "New charter"
          ) : (
            "New test case"
          )}
        </h1>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-400 sm:inline">
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> saves
            {!caseId && (
              <>
                {" "}
                · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> saves and starts another
              </>
            )}
          </span>
          <Button onClick={() => router.back()}>Cancel</Button>
          {!caseId && (
            <Button disabled={pending} onClick={() => save(true)}>
              Create and new
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending
              ? "Saving…"
              : caseId
                ? "Save new version"
                : isCharter
                  ? "Create charter"
                  : "Create case"}
          </Button>
        </div>
      </div>

      <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText>
      {made && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span className="flex-1">
            ✓ {caseKey(projectKey, made.number)} &ldquo;{made.title}&rdquo; created. Folder, priority, type and tags kept for this one.
          </span>
          <a href={`/p/${projectKey}/cases/${made.number}`} className="font-medium text-emerald-800 underline">
            Open {caseKey(projectKey, made.number)}
          </a>
        </p>
      )}

      <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
        <Field label="Title" htmlFor="title">
          {/* Type [WEB] at the start and it turns into a tag pill (ver_96); Backspace at the start turns the last pill back into text. */}
          <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-slate-300 bg-surface px-2 shadow-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
            <TagPills tags={tags} colors={props.tagColors} />
            <input
              id="title"
              required
              autoFocus={!caseId}
              value={title}
              onChange={(e) => {
                const v = e.target.value;
                const at = e.target.selectionStart ?? v.length;
                const m = v.length > title.length && v[at - 1] === "]" ? v.match(/^\s*\[([^\][]{1,24})\]\s*(?:[-–—:|]\s*)?/) : null;
                if (m && m[1].trim()) {
                  const word = m[1].trim();
                  const named = [...(props.platformNames ?? []), ...props.knownTags].find((p) => p.toLowerCase() === word.toLowerCase()) ?? word;
                  if (!tags.some((t) => t.toLowerCase() === named.toLowerCase())) setTags([...tags, named]);
                  setTitle(v.slice(m[0].length));
                  justTagged.current = true;
                } else if (justTagged.current && /^\s*(?:[-–—:|]\s*)?$/.test(v)) {
                  // The " - " typed after [WEB] isn't part of the title.
                  setTitle("");
                } else {
                  justTagged.current = false;
                  setTitle(v);
                }
                touch();
              }}
              onKeyDown={(e) => {
                const el = e.currentTarget;
                if (e.key === "Backspace" && tags.length && el.selectionStart === 0 && el.selectionEnd === 0) {
                  e.preventDefault();
                  const last = tags[tags.length - 1];
                  setTags(tags.slice(0, -1));
                  setTitle(`[${last}]${title ? ` ${title}` : ""}`);
                  touch();
                  requestAnimationFrame(() => el.setSelectionRange(last.length + 2, last.length + 2));
                }
              }}
              placeholder={
                isCharter
                  ? "Explore checkout with a flaky connection"
                  : tags.length ? "Checkout succeeds with a saved card" : "Checkout succeeds with a saved card (start with [WEB] to tag it)"
              }
              className="min-w-40 flex-1 border-0 bg-transparent py-1.5 text-base font-medium outline-none"
            />
          </div>
        </Field>
        <div
          className={cx(
            "grid gap-4 sm:grid-cols-2",
            isCharter ? "lg:grid-cols-4" : moreFields ? "lg:grid-cols-5" : "lg:grid-cols-3",
          )}
        >
          <Field label="Folder" htmlFor="folder">
            <Select
              id="folder"
              value={folderId}
              onChange={(e) => {
                setFolderId(e.target.value);
                touch();
              }}
            >
              <option value="">(No folder)</option>
              {props.folderOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="priority">
            <Select
              id="priority"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as Priority);
                touch();
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          {isCharter ? (
            <Field label="Time limit" htmlFor="timebox">
              <Select
                id="timebox"
                value={charter.minutes}
                onChange={(e) =>
                  setCharterField("minutes", Number(e.target.value))
                }
              >
                {[...new Set([...TIME_BOXES, charter.minutes])]
                  .sort((x, y) => x - y)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m < 60
                        ? `${m} minutes`
                        : m % 60
                          ? `${Math.floor(m / 60)} h ${m % 60} min`
                          : `${m / 60} ${m === 60 ? "hour" : "hours"}`}
                    </option>
                  ))}
              </Select>
            </Field>
          ) : !moreFields ? null : (
            <>
              <Field label="Type" htmlFor="type">
                <Select
                  id="type"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as CaseType);
                    touch();
                  }}
                >
                  <option value="MANUAL">Manual</option>
                  <option value="AUTOMATED">Automated</option>
                </Select>
              </Field>
              <Field
                label="Automation ID"
                htmlFor="automationId"
                hint={
                  type === "AUTOMATED"
                    ? "Matches CI results to this case"
                    : undefined
                }
              >
                <Input
                  id="automationId"
                  value={automationId}
                  placeholder="Optional"
                  className="font-mono text-xs"
                  onChange={(e) => {
                    setAutomationId(e.target.value);
                    touch();
                  }}
                />
              </Field>
            </>
          )}
          {(isCharter || moreFields) && <Field label="Persona" htmlFor="persona">
            <Select
              id="persona"
              value={personaId}
              onChange={(e) => {
                if (e.target.value === NEW_PERSONA)
                  return setAddingPersona(true);
                setPersonaId(e.target.value);
                touch();
              }}
            >
              <option value="">(None)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
              {props.canManageShared && (
                <option value={NEW_PERSONA}>+ New persona…</option>
              )}
            </Select>
          </Field>}
          {addingPersona && (
            <PersonaForm
              projectId={projectId}
              persona={null}
              onClose={() => setAddingPersona(false)}
              onSaved={(p) => {
                setPersonas((list) =>
                  [...list, p].sort((a, b) => a.name.localeCompare(b.name)),
                );
                setPersonaId(p.id);
                touch();
              }}
            />
          )}
        </div>
        {!isCharter && !moreFields && (
          <button type="button" onClick={() => setMoreFields(true)} className="text-sm text-accent-700 hover:underline">
            ▸ More fields: type, automation ID, persona
          </button>
        )}
        <TagInput
          colors={props.tagColors}
          tags={tags}
          known={props.knownTags}
          onChange={(t) => {
            setTags(t);
            touch();
          }}
        />
        {props.extra}
        <Field
          label={isCharter ? "Setup (optional)" : "Preconditions"}
          htmlFor="preconditions"
        >
          <Textarea
            id="preconditions"
            rows={2}
            value={preconditions}
            onChange={(e) => {
              setPreconditions(e.target.value);
              touch();
            }}
            placeholder={
              isCharter
                ? "Accounts, devices or builds to have ready before the session"
                : "Test data, environment or state needed before step 1"
            }
          />
        </Field>
      </div>

      {isCharter ? (
        <>
          <CharterFields charter={charter} onChange={setCharterField} />
          <section aria-label="Reminders" className="mt-4">
            <h3 className="text-sm font-medium text-slate-700">
              Reminders{" "}
              <span className="font-normal text-slate-500">
                (optional) · go off during every session of this charter
              </span>
            </h3>
            <div className="mt-1.5">
              <ReminderRows
                idPrefix="charter-reminder"
                reminders={charter.reminders}
                onChange={(r) => setCharterField("reminders", r)}
              />
            </div>
          </section>
          <PromptRows prompts={charter.prompts} onChange={(p) => setCharterField("prompts", p)} />
        </>
      ) : (
        <>
          <div className="mt-6 mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Steps</h2>
            <div className="flex items-center gap-2">
              {props.canManageShared && selectedPlain.length > 0 && (
                <Button size="sm" onClick={() => setConverting(true)} title="Shares only these steps, not the whole case">
                  Make shared step from {selectedPlain.length} selected
                </Button>
              )}
              {props.canManageShared && selectedPlain.length === 0 && items.filter((i) => i.kind === "step").length > 1 && (
                <span className="text-xs text-slate-500">Tick steps to turn them into a shared step</span>
              )}
              <span className="hidden text-xs text-slate-400 sm:inline">
                <kbd>Ctrl</kbd>+<kbd>Enter</kbd> in a step adds one below
              </span>
            </div>
          </div>

          {added && (
            <p role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-slate-800">
              <span className="flex-1">{added.text}</span>
              <button type="button" aria-label="Dismiss" className="text-slate-400 hover:text-slate-700" onClick={() => setAdded(null)}>
                ×
              </button>
            </p>
          )}
          <ol>
            {items.map((item, index) => (
              <Fragment key={item.uid}>
              {index > 0 && (
                <li className="group/gap relative z-10 flex h-3 items-center justify-center">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-accent-300 opacity-0 transition-opacity group-hover/gap:opacity-100 group-focus-within/gap:opacity-100" />
                  <span className="relative flex gap-1 opacity-0 transition-opacity group-hover/gap:opacity-100 group-focus-within/gap:opacity-100">
                    <button
                      type="button"
                      className="rounded-full border border-accent-300 bg-surface px-2 text-[11px] leading-4 font-medium text-accent-700 hover:bg-accent-50"
                      aria-label={`Add a step between steps ${index} and ${index + 1}`}
                      onClick={() => insertStepAfter(index - 1)}
                    >
                      + Step
                    </button>
                    {defs.size > 0 && (
                      <button
                        type="button"
                        className="rounded-full border border-violet-300 bg-surface px-2 text-[11px] leading-4 font-medium text-violet-700 hover:bg-violet-50"
                        aria-label={`Insert a shared step between steps ${index} and ${index + 1}`}
                        onClick={() => setPicker({ at: index })}
                      >
                        + Shared step
                      </button>
                    )}
                  </span>
                </li>
              )}
              <li
                key={item.uid}
                data-uid={item.uid}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  setDragOver(index);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) move(dragFrom, index);
                  setDragFrom(null);
                  setDragOver(null);
                }}
                className={cx(
                  "flex gap-2 rounded-lg border bg-surface p-3 shadow-sm",
                  item.kind === "shared"
                    ? "border-violet-200 bg-violet-50/40"
                    : "border-slate-200",
                  dragOver === index &&
                    dragFrom !== index &&
                    "ring-2 ring-accent-500",
                  glow === item.uid && "ring-2 ring-violet-400 transition-shadow",
                )}
              >
                <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-1">
                  <span
                    draggable
                    onDragStart={() => setDragFrom(index)}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    title="Drag to reorder"
                    className="cursor-grab text-slate-300 select-none hover:text-slate-500"
                  >
                    ⠿
                  </span>
                  <span className="text-sm font-semibold text-slate-500">
                    {numbering[index]}
                  </span>
                  {props.canManageShared && item.kind === "step" && (
                    <input
                      type="checkbox"
                      title="Select to turn into a shared step"
                      aria-label={`Select step ${index + 1}`}
                      checked={selected.has(item.uid)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(item.uid);
                          else n.delete(item.uid);
                          return n;
                        })
                      }
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {item.kind === "step" ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <Label className="sr-only">Action</Label>
                        <Textarea
                          rows={2}
                          aria-label={`Step ${index + 1} action`}
                          placeholder="Action"
                          value={item.action}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                              e.preventDefault();
                              insertStepAfter(index);
                            }
                          }}
                          onChange={(e) =>
                            update((prev) =>
                              prev.map((p) =>
                                p.uid === item.uid
                                  ? { ...p, action: e.target.value }
                                  : p,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label className="sr-only">Expected result</Label>
                        <Textarea
                          rows={2}
                          aria-label={`Step ${index + 1} expected result`}
                          placeholder="Expected result"
                          value={item.expected}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                              e.preventDefault();
                              insertStepAfter(index);
                            }
                          }}
                          onChange={(e) =>
                            update((prev) =>
                              prev.map((p) =>
                                p.uid === item.uid
                                  ? { ...p, expected: e.target.value }
                                  : p,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <SharedItem
                      def={defs.get(item.sharedStepId)}
                      params={item.params}
                      onParam={(name, value) =>
                        update((prev) =>
                          prev.map((p) =>
                            p.uid === item.uid && p.kind === "shared"
                              ? { ...p, params: { ...p.params, [name]: value } }
                              : p,
                          ),
                        )
                      }
                      projectKey={projectKey}
                    />
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-0.5">
                  <SmallBtn
                    label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    ↑
                  </SmallBtn>
                  <SmallBtn
                    label="Move down"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    ↓
                  </SmallBtn>
                  <SmallBtn
                    label="Remove"
                    onClick={() => {
                      update((prev) => prev.filter((p) => p.uid !== item.uid));
                      setSelected((s) => {
                        const n = new Set(s);
                        n.delete(item.uid);
                        return n;
                      });
                    }}
                  >
                    ×
                  </SmallBtn>
                </div>
              </li>
              </Fragment>
            ))}
          </ol>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => insertStepAfter(items.length - 1)}>
              + Add step
            </Button>
            <Button
              size="sm"
              onClick={() => setPicker({ at: items.length })}
              disabled={defs.size === 0}
              title={
                defs.size === 0
                  ? props.inLibrary
                    ? "No shared steps in the Case library yet"
                    : "No shared steps in this test cycle yet"
                  : undefined
              }
            >
              + Insert shared step
            </Button>
          </div>
        </>
      )}

      {caseId && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-surface p-4 shadow-sm">
          <Field
            label="What changed? (optional)"
            htmlFor="changeNote"
            hint="Shown in the version history."
          >
            <Input
              id="changeNote"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="Updated expected result for new checkout copy"
            />
          </Field>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={() => router.back()}>Cancel</Button>
        {!caseId && (
          <Button disabled={pending} onClick={() => save(true)}>
            Create and new
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? "Saving…"
            : caseId
              ? "Save new version"
              : isCharter
                ? "Create charter"
                : "Create case"}
        </Button>
      </div>

      <SharedPicker
        open={picker !== null}
        defs={[...defs.values()]}
        onClose={() => setPicker(null)}
        at={picker?.at ?? items.length}
        count={items.length}
        onPick={(def, params) => {
          const at = picker?.at ?? items.length;
          // Replace a trailing empty step rather than leaving it dangling.
          const last = items[items.length - 1];
          const base =
            at === items.length &&
            last?.kind === "step" &&
            !last.action &&
            !last.expected
              ? items.slice(0, -1)
              : items;
          const pos = Math.min(at, base.length);
          const block = withUid({ kind: "shared", sharedStepId: def.id, params });
          update(() => [...base.slice(0, pos), block, ...base.slice(pos)]);
          const n = pos + 1;
          const k = def.steps.length;
          const keepWith = caseId ? "Save new version" : "Create case";
          setAdded({
            text:
              k === 1
                ? `Added 1 shared step as step ${n}. Your other steps didn't change. Press ${keepWith} to keep it.`
                : `Added ${k} shared steps as ${n}.1 to ${n}.${k}. Your other steps didn't change. Press ${keepWith} to keep it.`,
          });
          setGlow(block.uid);
          setTimeout(() => setGlow((g) => (g === block.uid ? null : g)), 2500);
          setPicker(null);
        }}
      />

      <ConvertDialog
        open={converting}
        steps={selectedPlain.map((s) =>
          s.kind === "step"
            ? { action: s.action, expected: s.expected }
            : { action: "", expected: "" },
        )}
        onClose={() => setConverting(false)}
        onCreate={async (name, values) => {
          const steps = selectedPlain.map((s) =>
            s.kind === "step"
              ? { action: s.action, expected: s.expected }
              : { action: "", expected: "" },
          );
          const res = await saveSharedStep(projectId, null, {
            name,
            steps,
            parameters: [],
          });
          if (!res.ok) return res.error;
          const parameters = placeholdersIn(steps).map((n) => ({
            name: n,
            defaultValue: "",
          }));
          const def: SharedStepDef = {
            id: res.id,
            name,
            version: res.version,
            parameters,
            steps,
          };
          setDefs((d) => new Map(d).set(def.id, def));
          update((prev) => {
            const firstIdx = prev.findIndex((p) => selected.has(p.uid));
            const kept = prev.filter((p) => !selected.has(p.uid));
            const insertAt = prev
              .slice(0, firstIdx)
              .filter((p) => !selected.has(p.uid)).length;
            const ref = withUid({
              kind: "shared",
              sharedStepId: def.id,
              params: Object.fromEntries(Object.entries(values).filter(([k, v]) => parameters.some((p) => p.name === k) && v.trim())),
            });
            return [...kept.slice(0, insertAt), ref, ...kept.slice(insertAt)];
          });
          setSelected(new Set());
          setConverting(false);
          return null;
        }}
      />
    </form>
  );
}

function SharedItem({
  def,
  params,
  onParam,
  projectKey,
}: {
  def: SharedStepDef | undefined;
  params: Record<string, string>;
  onParam: (name: string, value: string) => void;
  projectKey: string;
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
          {def.parameters.map((p) => (
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
          ))}
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

function SharedPicker({
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
  const shown = defs.filter((d) =>
    d.name.toLowerCase().includes(q.toLowerCase()),
  );
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
          {shown.map((d) => (
            <li key={d.id}>
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

function ConvertDialog({
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
  // Each {{parameter}} gets this case's value here, so the case doesn't show a raw {{user}} (ver_89).
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

function TagInput({
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

function SmallBtn({
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

const NEW_PERSONA = "__new";

/** Prompts (ver_93): things to try, ticked in the session. Tours and checklists fill them in. */
function PromptRows({ prompts, onChange }: { prompts: string[]; onChange: (p: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || prompts.length >= 30) return;
    onChange([...prompts, v]);
    setDraft("");
  };
  return (
    <section aria-label="Prompts" className="mt-4">
      <h3 className="text-sm font-medium text-slate-700">
        Prompts <span className="font-normal text-slate-500">(optional) · things to try, ticked off during the session</span>
      </h3>
      {prompts.length > 0 && (
        <ul className="mt-1.5 space-y-1">
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
function CharterFields({
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
