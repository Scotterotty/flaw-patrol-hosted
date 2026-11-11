"use client";

import type { Severity } from "@prisma/client";
import { useRef } from "react";
import { isDxdiag, isMedia, templateTitle, withHistory, type ByHand, type History, type TemplateBug } from "@/lib/bug-template";
import { AE_SCALE, type SeverityScale } from "@/lib/severity";
import { AddMenu, FileTicks, type BugCapture, type BugFile } from "./bug-files";
import { cx, Input, Select, Textarea } from "./ui";

export type TemplateOptions = { clients: string[]; team: string[]; olyEnv: string[] };
type File_ = BugFile;

const Auto = ({ children }: { children: string }) => <span className="ml-1.5 rounded bg-accent-50 px-1.5 py-px text-[11px] font-medium text-accent-700">{children}</span>;

const AutoTag = ({ text }: { text?: string }) => (text ? <Auto>{text}</Auto> : null);

function L({ htmlFor, children, auto }: { htmlFor?: string; children: string; auto?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-slate-600">
      {children}
      {auto && <Auto>{auto}</Auto>}
    </label>
  );
}

const Section = ({ children, note }: { children: string; note?: string }) => (
  <p className="text-[11px] font-bold tracking-wider text-slate-700">
    {children}
    {note && <span className="font-medium tracking-normal text-slate-500"> · {note}</span>}
  </p>
);

/** Pick any number of a Jira field's options, as chips. */
export function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {all.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cx("rounded-full border px-2.5 py-0.5 text-[13px]", on ? "border-accent-600 bg-accent-600 text-white" : "border-slate-300 bg-surface text-slate-700 hover:border-slate-400")}
          >
            {o}
          </button>
        );
      })}
      {!all.length && <span className="text-xs text-slate-500">This Jira has no options for this field.</span>}
    </div>
  );
}

// Which clients it takes to see the bug: one, or a mix (a Web user and an Unreal user in one space).
export const REPRO_CLIENTS = ["Web", "Unity", "Unreal"];

/**
 * Carry a numbered list for the typist: Enter after "3. foo" starts "4. ",
 * Enter on an empty "4. " ends the list, and the numbers below renumber. Plain
 * text is left to the textarea.
 */
export function autoNumber(e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void) {
  if (e.key !== "Enter" || e.shiftKey) return;
  const el = e.currentTarget;
  const { selectionStart, selectionEnd, value } = el;
  if (selectionStart !== selectionEnd) return;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const line = value.slice(lineStart, selectionStart);
  const m = /^(\s*)(\d+)\.\s(.*)$/.exec(line);
  if (!m) return;
  e.preventDefault();
  const [, indent, num, rest] = m;
  // Enter on an empty item: drop the "N. " and end the list.
  if (!rest.trim()) {
    const next = value.slice(0, lineStart) + value.slice(selectionStart);
    onChange(next);
    requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
    return;
  }
  const insert = `\n${indent}${Number(num) + 1}. `;
  // Renumber the run of numbered lines that follows, so inserting in the middle keeps them in order.
  const after = value.slice(selectionStart);
  let n = Number(num) + 2;
  const renumbered = after.replace(/^((?:\n\s*\d+\.\s.*)*)/, (run) => run.replace(/(\n\s*)\d+(\.\s)/g, (_, a, b) => `${a}${n++}${b}`));
  const next = value.slice(0, selectionStart) + insert + renumbered;
  onChange(next);
  const caret = selectionStart + insert.length;
  requestAnimationFrame(() => el.setSelectionRange(caret, caret));
}

/** Where the form was opened: a run's Report a bug, a bug bash's File this bug, or + Write a bug. */
export type BugFrom = "run" | "bash" | "written";

/**
 * The little tag beside a box says what filled it in. A run and a bash fill the same boxes; Write a
 * bug has no run or case, so its tags only show on boxes that really started filled (Scott, Nov 10).
 */
type Tags = { run: string; bash: string; written?: string };

const HISTORY: { key: keyof History; label: string; rows: number; tags?: Tags; hint: string; wide?: boolean }[] = [
  { key: "dateTime", label: "Date & time", rows: 2, tags: { run: "now", bash: "now", written: "now" }, hint: "2026/11/10" },
  { key: "client", label: "Client", rows: 2, tags: { run: "run build", bash: "bash build", written: "test cycle build" }, hint: "Client Version" },
  { key: "csp", label: "CSP", rows: 2, tags: { run: "run CSP", bash: "bash CSP" }, hint: "xx.xx.x" },
  { key: "context", label: "Context", rows: 4, tags: { run: "remembered", bash: "remembered", written: "remembered" }, hint: "Browser\nGraphics Driver\nDevice\nOS", wide: true },
  { key: "user", label: "User name & ID", rows: 3, tags: { run: "remembered", bash: "remembered", written: "remembered" }, hint: "Display Name & ID", wide: true },
  { key: "envTenant", label: "Env & tenant", rows: 3, tags: { run: "run env", bash: "bash env", written: "test cycle env" }, hint: "Env.\nTenant" },
  { key: "repros", label: "Repros", rows: 1, hint: "x/x" },
];

const T = {
  clientTag: { run: "from run", bash: "from bash", written: "usual answer" },
  feature: { run: "from case", bash: "from bash" },
  observedOn: { run: "from run", bash: "from bash" },
  clientsNeeded: { run: "from run", bash: "from bash" },
  what: { run: "your Actual result", bash: "from bash" },
  clients: { run: "test cycle default", bash: "test cycle default", written: "usual answer" },
  team: { run: "test cycle default", bash: "test cycle default", written: "usual answer" },
  olyEnv: { run: "from run env", bash: "from bash env", written: "usual answer" },
} satisfies Record<string, Tags>;

/** Was this box filled in when the form opened? Lists count when they have anything in them. */
const hasValue = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "");

/** Text boxes in the bug form start roomy and grow with what you type (roomier bug form, Nov 10). */
export const GROW = "field-sizing-content max-h-[60vh]";

/**
 * The team bug template (OB-5292) as a form: the title in three parts, the
 * description, the Reproduction History row, the OKO Jira fields and the
 * attachments, screenshots and videos first, then logs.
 */
export function BugTemplateForm({
  bug,
  setBug,
  options,
  severity,
  setSeverity,
  scale = AE_SCALE,
  priority = null,
  files,
  include,
  setInclude,
  onAdd,
  uploading,
  candidates = [],
  onPick = () => {},
  capture,
  jiraLimit = null,
  from = "run",
}: {
  bug: TemplateBug;
  setBug: (fn: (b: TemplateBug) => TemplateBug) => void;
  options: TemplateOptions;
  severity: Severity;
  setSeverity: (s: Severity) => void;
  /** The team's severity names. */
  scale?: SeverityScale;
  /** The Jira Priority this bug gets (Settings → Jira), or null when Jira picks it. */
  priority?: string | null;
  files: File_[];
  include: Set<string>;
  setInclude: (fn: (s: Set<string>) => Set<string>) => void;
  onAdd: (files: File[]) => void;
  uploading: boolean;
  /** Files from elsewhere in the case that aren't on the bug yet (+ Add ▾ › From this case). */
  candidates?: File_[];
  onPick?: (files: File_[]) => void;
  capture?: BugCapture;
  /** Jira's per-file limit: bigger files are flagged (ver_185). */
  jiraLimit?: number | null;
  /** Where the form was opened, for the tags beside the boxes. The fields are the same everywhere. */
  from?: BugFrom;
}) {
  const set = <K extends keyof TemplateBug>(k: K, v: TemplateBug[K]) => setBug((b) => ({ ...b, [k]: v }));
  // Repro rate follows Repros, and Build # follows Client and CSP, until typed in by hand; emptying one makes it follow again.
  const byHand = useRef<ByHand>({ reproRate: false, build: false });
  // What the form opened with, so Write a bug only tags boxes that really started filled.
  const opened = useRef(bug);
  const tag = (t: Tags | undefined, start: unknown) => (!t ? undefined : from !== "written" ? t[from] : hasValue(start) ? t.written : undefined);
  const setH = (k: keyof History, v: string) => setBug((b) => withHistory(b, k, v, byHand.current));
  const media = files.filter((f) => isMedia(f.contentType));
  const logs = files.filter((f) => !isMedia(f.contentType));
  const listed = files.filter((f) => include.has(f.id) && !isDxdiag(f.fileName)).length;

  const fileGroup = (title: string, group: File_[], button: string, accept: string, from: File_[], capture?: BugCapture, what?: string) => (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold text-slate-600">{title}</legend>
      <FileTicks files={group} include={include} setInclude={setInclude} history jiraLimit={jiraLimit}>
        <AddMenu label={button} candidates={from} onPick={onPick} onUpload={onAdd} accept={accept} capture={capture} uploading={uploading} what={what} />
      </FileTicks>
    </fieldset>
  );

  return (
    // Hints a shade darker than the app's usual placeholder, so they pass 4.5:1 in every look.
    <div className="space-y-5 [&_input::placeholder]:text-slate-500 [&_textarea::placeholder]:text-slate-500" data-testid="bug-template">
      <div className="space-y-2">
        <Section>TITLE</Section>
        <div className="grid gap-2.5 sm:grid-cols-[150px_200px_minmax(0,1fr)]">
          <div>
            <L htmlFor="t-tag" auto={tag(T.clientTag, opened.current.clientTag)}>
              Client(s)
            </L>
            <Input id="t-tag" value={bug.clientTag} onChange={(e) => set("clientTag", e.target.value.toUpperCase())} placeholder="e.g. WEB" />
          </div>
          <div>
            <L htmlFor="t-feature" auto={tag(T.feature, opened.current.feature)}>
              Feature
            </L>
            <Input id="t-feature" value={bug.feature} onChange={(e) => set("feature", e.target.value)} placeholder="Which feature? e.g. Avatars" />
          </div>
          <div>
            <L htmlFor="t-brief">Brief summary</L>
            <Input id="t-brief" data-howto="bug-summary" value={bug.brief} onChange={(e) => set("brief", e.target.value)} required autoFocus placeholder="What's wrong, in a few words" />
          </div>
        </div>
        <p className="text-[13px] text-slate-600">
          Jira title: <span className="font-semibold text-slate-900" data-testid="template-title">{templateTitle(bug)}</span>
        </p>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <div>
          <L htmlFor="t-severity">Severity</L>
          <Select id="t-severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            {scale.levels.map((s) => (
              <option key={s} value={s}>
                {scale.labels[s]}
              </option>
            ))}
          </Select>
        </div>
        {priority && (
          <div data-testid="bug-priority">
            <p className="mb-1 text-xs font-semibold text-slate-600">Jira Priority</p>
            <p className="py-2 text-sm text-slate-600">{priority} (set in Settings → Jira)</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Section>DESCRIPTION</Section>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <L htmlFor="t-observed" auto={tag(T.observedOn, opened.current.observedOn)}>
              Issue observed on
            </L>
            <Input id="t-observed" value={bug.observedOn} onChange={(e) => set("observedOn", e.target.value)} placeholder="Where you saw it, e.g. Web 2.4.2 on Chrome" />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">
              Clients needed for repro
              <AutoTag text={tag(T.clientsNeeded, opened.current.clientsNeeded)} />
            </p>
            <Chips
              label="Clients needed for repro"
              options={REPRO_CLIENTS}
              value={bug.clientsNeeded.split(/\s*,\s*/).filter(Boolean)}
              onChange={(v) => set("clientsNeeded", REPRO_CLIENTS.filter((c) => v.includes(c)).concat(v.filter((c) => !REPRO_CLIENTS.includes(c))).join(", "))}
            />
          </div>
        </div>
        <div>
          <L htmlFor="t-what" auto={tag(T.what, opened.current.what)}>
            What happened
          </L>
          <Textarea id="t-what" rows={4} className={cx("min-h-28", GROW)} value={bug.what} onChange={(e) => set("what", e.target.value)} placeholder="What went wrong, and what you expected instead" />
        </div>
        <div>
          <L htmlFor="t-slack">Slack thread (optional)</L>
          <Input id="t-slack" value={bug.slack} onChange={(e) => set("slack", e.target.value)} placeholder="Paste the Slack link. Leave blank and THREADS is left out." />
        </div>
      </div>

      <div className="space-y-3">
        <Section note="shown under the description, above Reproduction History">ATTACHMENTS</Section>
        {fileGroup("1. Screenshots & videos", media, "+ Add", "image/*,video/*", candidates.filter((f) => isMedia(f.contentType)), capture)}
        {fileGroup("2. Client logs", logs, "+ Add log", ".txt,.log,.json,.zip,.pdf,text/plain", candidates.filter((f) => !isMedia(f.contentType)), undefined, "Log files")}
      </div>

      <div className="space-y-2">
        <Section note={from === "written" ? "type what you know" : "filled in for you, edit anything"}>REPRODUCTION HISTORY</Section>
        {/* Laid out by the box's own width, never a sideways scroll: 4 across in a wide box, 2 in a narrow one, 1 on a phone (roomier bug form, Nov 10). */}
        <div className="@container rounded-lg border border-slate-200 p-3">
          <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4" data-testid="repro-history">
            {HISTORY.map((h) => (
              <div key={h.key} className={cx("min-w-0", h.wide && "@md:col-span-2")}>
                <L htmlFor={`h-${h.key}`} auto={tag(h.tags, opened.current.history[h.key])}>
                  {h.label}
                </L>
                <Textarea
                  id={`h-${h.key}`}
                  rows={2}
                  value={bug.history[h.key]}
                  onChange={(e) => setH(h.key, e.target.value)}
                  placeholder={h.hint}
                  className={cx("min-h-16 text-sm", GROW)}
                />
              </div>
            ))}
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-600">Attachments</p>
              <p className={cx("py-1 text-sm", listed ? "text-slate-700" : "text-slate-500")}>{listed ? `${listed} file${listed === 1 ? "" : "s"}, linked` : "Inline Attachments"}</p>
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Context and User name &amp; ID are yours to type. Whatever you use is remembered and filled in next time (User name &amp; ID for each environment);
          change it whenever your machine or account changes.
        </p>
      </div>

      <div className="space-y-3">
        <Section>JIRA FIELDS</Section>
        <div>
          <L htmlFor="t-steps">Repro steps</L>
          <Textarea
            id="t-steps"
            rows={8}
            value={bug.reproSteps}
            onChange={(e) => set("reproSteps", e.target.value)}
            onKeyDown={(e) => autoNumber(e, (v) => set("reproSteps", v))}
            placeholder="Describe the steps to reproduce. Type 1. and press Enter to start a numbered list."
            className={cx("min-h-48 font-mono text-[12.5px]", GROW)}
          />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <L htmlFor="t-space">OKO Space link</L>
            <Input id="t-space" value={bug.spaceLink} onChange={(e) => set("spaceLink", e.target.value)} placeholder="N/a" />
          </div>
          <div>
            <L htmlFor="t-rate" auto="from Repros">
              Repro rate
            </L>
            <Input id="t-rate" value={bug.reproRate} onChange={(e) => {
                byHand.current.reproRate = e.target.value.trim() !== "";
                set("reproRate", e.target.value);
              }}
            />
          </div>
          <div>
            <L htmlFor="t-impact">Bug impact</L>
            <Textarea id="t-impact" rows={3} className={cx("min-h-20", GROW)} value={bug.impact} onChange={(e) => set("impact", e.target.value)} placeholder="Who is hurt, how badly" />
          </div>
          <div>
            <L htmlFor="t-workaround">Bug workaround</L>
            <Textarea id="t-workaround" rows={3} className={cx("min-h-20", GROW)} value={bug.workaround} onChange={(e) => set("workaround", e.target.value)} placeholder="None known" />
          </div>
        </div>
        <div>
          <L htmlFor="t-build" auto="from Client & CSP">
            Build #
          </L>
          <Input
            id="t-build"
            value={bug.build}
            placeholder="Version x - CSP x"
            onChange={(e) => {
              byHand.current.build = e.target.value.trim() !== "";
              set("build", e.target.value);
            }}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">
            Client/SKUs
            <AutoTag text={tag(T.clients, opened.current.clients)} />
          </p>
          <Chips label="Client/SKUs" options={options.clients} value={bug.clients} onChange={(v) => set("clients", v)} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <L htmlFor="t-team" auto={tag(T.team, opened.current.team)}>
              Team
            </L>
            {options.team.length ? (
              <Select id="t-team" value={bug.team} onChange={(e) => set("team", e.target.value)}>
                <option value="">Choose a team</option>
                {options.team.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Input id="t-team" value={bug.team} onChange={(e) => set("team", e.target.value)} />
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">
              Oly Environment
              <AutoTag text={tag(T.olyEnv, opened.current.olyEnv)} />
            </p>
            <Chips label="Oly Environment" options={options.olyEnv} value={bug.olyEnv} onChange={(v) => set("olyEnv", v)} />
          </div>
        </div>
      </div>
    </div>
  );
}
