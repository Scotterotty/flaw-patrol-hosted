"use client";

import { TagPills } from "./tag-pill";
import { areaCandidate, pillLeads, typedKnownArea, type AreaContext } from "@/lib/area-tags";
import { type TagColors } from "@/lib/tags";
import type { CaseType, Priority } from "@prisma/client";
import { useRouter } from "next/navigation";
import { noteSavedVersion, useFreshVersion } from "./fresh-version";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { PersonaForm, TestPersonaPicker } from "./personas";
import { BLANK_CHARTER, TIME_BOXES, type Charter } from "@/lib/charter";
import { ReminderRows } from "./reminders";
import { caseKey, PRIORITIES, PRIORITY_LABEL } from "@/lib/format";
import { placeholdersIn, type CaseStepItem, type SharedStepDef } from "@/lib/steps";
import { hasExpected, isSectionTitle } from "@/lib/step-checks";
import { saveCase } from "@/server/cases";
import { skipAreaWord } from "@/server/tags";
import { linkStory } from "@/server/stories";
import Link from "next/link";
import { saveSharedStep } from "@/server/shared-steps";
import { testDataProblem, type TestData } from "@/lib/test-data";
import { TestDataBox } from "./test-data-box";
import { Button, cx, ErrorText, Field, Input, Label, Select, Textarea } from "./ui";
import { NEW_PERSONA, TagInput, CharterFields, PromptRows, SharedItem, SmallBtn, SharedPicker, ConvertDialog } from "./case-editor-parts";

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
    /** Test data: the table the case runs once per row of, or null. */
    testData?: TestData | null;
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
  /** Tag pill colors and the umbrella's platform names, so [WEB] becomes Web. */
  tagColors?: TagColors;
  platformNames?: string[];
  /** Area tags: words this library said No to. */
  areaSkip?: string[];
  /** Writing steps for cases just made from a requirement: where Save goes next. */
  queue?: { story: string; at: number; total: number; next: string | null; back: string };
  /** A new case made from a requirement: linked to it once created. */
  linkTo?: string;
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
  // Back after Save can bring up the editor as it was; it reloads then.
  useFreshVersion(caseId, props.version);
  const [title, setTitle] = useState(initial.title);
  const justTagged = useRef(false);
  // Area tags: pills added from the word after the platform, and words said No to here.
  const [areaAdded, setAreaAdded] = useState<string[]>([]);
  const [areaNo, setAreaNo] = useState<string[]>([]);
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
  const [testData, setTestDataRaw] = useState<TestData | null>(initial.testData ?? null);
  const setTestData = (d: TestData | null) => {
    setTestDataRaw(d);
    touch();
  };
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
  // Steps that will show as section titles (nothing to check, names the steps below), so the
  // editor can say so before the case is saved. Shared steps count as steps after them.
  const titleSteps = useMemo(() => {
    const flat = items.flatMap((it, i) =>
      it.kind === "step" ? [{ action: it.action, expected: it.expected, i }] : (defs.get(it.sharedStepId)?.steps ?? []).map((s) => ({ ...s, i: -1 })),
    );
    const out = new Set<number>();
    flat.forEach((f, k) => {
      if (f.i >= 0 && isSectionTitle(flat, k)) out.add(f.i);
    });
    return out;
  }, [items, defs]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<{ at: number } | null>(null);
  // What the last insert did, said out loud, and the inserted block glows for a moment.
  const [added, setAdded] = useState<{ text: string } | null>(null);
  const [glow, setGlow] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, start] = useTransition();
  // Saved and opening the next page: the buttons keep saying Saving… until it shows.
  const [leaving, setLeaving] = useState(false);
  const pending = saving || leaving;
  // Opened outside the save's transition, so Next loads the next page once instead of twice (as ver_111 found in the runner).
  const leave = useCallback(
    (href: string) => {
      setLeaving(true);
      setTimeout(() => router.push(href), 0);
    },
    [router],
  );
  const focusUid = useRef<string | null>(null);
  // After Create and new: the case just made, so it can be opened.
  const [made, setMade] = useState<{ number: number; title: string } | null>(null);
  // Type, automation ID and persona fold away unless a case already uses one.
  const [moreFields, setMoreFields] = useState(initial.type === "AUTOMATED" || !!initial.automationId || !!initial.personaId);

  const touch = () => setDirty(true);
  const areaCtx: AreaContext = { platforms: props.platformNames ?? [], known: props.knownTags, skip: [...(props.areaSkip ?? []), ...areaNo] };
  const afterPlatform = pillLeads(tags, areaCtx);
  const areaAsk = afterPlatform && !isCharter ? areaCandidate(title, tags, areaCtx) : null;
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
    const tableProblem = isCharter ? null : testDataProblem(testData);
    if (tableProblem) {
      setError(tableProblem);
      return;
    }
    start(async () => {
      // Leaving for another page after this save: that page is drawn once, fresh.
      const leaving = !(andNew && !caseId) && !props.linkTo;
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
        testData: isCharter ? null : testData,
        changeNote,
      }, { leaving });
      if (!res.ok) return setError(res.error);
      setDirty(false);
      if (res.caseId && res.changed !== false) noteSavedVersion(res.caseId, res.version);
      if (!caseId && props.linkTo && res.caseId) {
        const l = await linkStory(projectId, [res.caseId], props.linkTo, "add");
        if (!l.ok) return setError(l.error);
      }
      if (props.queue) {
        leave(props.queue.next ?? props.queue.back);
        return;
      }
      if (andNew && !caseId) {
        // Keep folder, priority, type, tags and persona; start the next case blank.
        setMade({ number: res.number, title });
        setTitle("");
        setPreconditions("");
        setAutomationId("");
        setItems([blankStep()]);
        setTestDataRaw(null);
        setCharter((c) => ({ ...BLANK_CHARTER, minutes: c.minutes }));
        setSelected(new Set());
        document.getElementById("title")?.focus();
        router.refresh();
        return;
      }
      leave(`/p/${projectKey}/cases/${res.number}`);
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
    leave,
    isCharter,
    charter,
    personaId,
    testData,
    props.linkTo,
    props.queue,
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
              : props.queue
                ? props.queue.next
                  ? "Save and next case"
                  : "Save and back to Requirements"
                : caseId
                ? "Save new version"
                : isCharter
                  ? "Create charter"
                  : "Create case"}
          </Button>
        </div>
      </div>

      {props.queue && (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-accent-900" data-testid="writing-queue">
          <span className="flex-1">
            Writing {props.queue.at} of {props.queue.total} new {props.queue.total === 1 ? "case" : "cases"} for <span className="font-mono font-medium">{props.queue.story}</span>.
          </span>
          {props.queue.next && (
            <Link href={props.queue.next} className="font-medium text-accent-700 hover:underline">
              Skip to next
            </Link>
          )}
          <Link href={props.queue.back} className="font-medium text-accent-700 hover:underline">
            Back to Requirements
          </Link>
        </p>
      )}
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
          {/* Type [WEB] at the start and it turns into a tag pill; Backspace at the start turns the last pill back into text. */}
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
                let area: ReturnType<typeof typedKnownArea> = null;
                const m = v.length > title.length && v[at - 1] === "]" ? v.match(/^\s*\[([^\][]{1,24})\]\s*(?:[-–—:|]\s*)?/) : null;
                if (m && m[1].trim()) {
                  const word = m[1].trim();
                  const named = [...(props.platformNames ?? []), ...props.knownTags].find((p) => p.toLowerCase() === word.toLowerCase()) ?? word;
                  if (!tags.some((t) => t.toLowerCase() === named.toLowerCase())) setTags([...tags, named]);
                  setTitle(v.slice(m[0].length));
                  justTagged.current = true;
                } else if (afterPlatform && v.length > title.length && (area = typedKnownArea(v, tags, areaCtx))) {
                  // A word the library already has as a tag, right after the platform.
                  setTags([...tags, area.word]);
                  setAreaAdded([...areaAdded, area.word]);
                  setTitle(area.rest);
                  justTagged.current = !area.rest;
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
                  if (areaAdded.includes(last)) {
                    // An area pill goes back to a plain word and isn't turned into a tag again here.
                    setTags(tags.slice(0, -1));
                    setAreaAdded(areaAdded.filter((t) => t !== last));
                    setAreaNo([...areaNo, last]);
                    setTitle(`${last}${title ? ` ${title}` : " "}`);
                    touch();
                    requestAnimationFrame(() => el.setSelectionRange(last.length + 1, last.length + 1));
                    return;
                  }
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
          {areaAsk && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-1.5 text-sm text-slate-700" data-testid="area-ask">
              <span className="min-w-0 flex-1">
                Make <strong>&ldquo;{areaAsk.word}&rdquo;</strong> a tag? It looks like a part of the app.
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setTags([...tags, areaAsk.word]);
                  setAreaAdded([...areaAdded, areaAsk.word]);
                  setTitle(areaAsk.rest);
                  touch();
                }}
              >
                Make it a tag
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setAreaNo([...areaNo, areaAsk.word]);
                  void skipAreaWord(projectId, areaAsk.word);
                }}
              >
                No
              </Button>
            </p>
          )}
        </Field>
        <div
          className={cx(
            "grid gap-4 sm:grid-cols-2",
            isCharter ? "lg:grid-cols-3" : moreFields ? "lg:grid-cols-5" : "lg:grid-cols-3",
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
          {!isCharter && moreFields && <Field label="Persona" htmlFor="persona">
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
        {props.extra && <Fragment key="extra">{props.extra}</Fragment>}
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
          <TestPersonaPicker
            projectId={projectId}
            personas={personas}
            value={personaId}
            canCreate={props.canManageShared}
            onChange={(id) => {
              setPersonaId(id);
              touch();
            }}
            onCreated={(p) => setPersonas((list) => [...list, p].sort((a, b) => a.name.localeCompare(b.name)))}
          />
          {/* Its own box like Mission, so it doesn't read as a footnote (ver_54 audit #7). */}
          <section aria-label="Reminders" className="mt-4 rounded-lg border border-slate-200 bg-surface p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Reminders</h2>
            <p className="text-xs text-slate-500">Optional. They go off during every session of this charter.</p>
            <div className="mt-3">
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
                        {titleSteps.has(index) ? (
                          <span className="mt-1 inline-block rounded bg-accent-50 px-1.5 py-0.5 text-[11px] font-semibold text-accent-700">
                            Section title
                          </span>
                        ) : (
                          item.action.trim() !== "" &&
                          !hasExpected(item.expected) && <span className="mt-1 block text-xs text-slate-500">Step with no expected result</span>
                        )}
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
                      columns={testData?.columns ?? []}
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
          <p className="mt-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">Tip:</span> a short name with no expected result, like SIGN IN STEPS or Space Lists, becomes a section
            title for the steps below it. So does any short line with a dash or N/A as its expected result.
          </p>
          <TestDataBox
            value={testData}
            onChange={setTestData}
            plainTexts={items.flatMap((it, i) => (it.kind === "step" ? [{ step: i + 1, text: `${it.action}\n${it.expected}` }] : []))}
            sharedBlanks={[...new Set(items.flatMap((it) => (it.kind === "shared" ? (defs.get(it.sharedStepId)?.parameters.map((p) => p.name) ?? []) : [])))]}
          />
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
            : props.queue
              ? props.queue.next
                ? "Save and next case"
                : "Save and back to Requirements"
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
