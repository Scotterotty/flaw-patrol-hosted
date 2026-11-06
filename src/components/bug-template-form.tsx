"use client";

import type { Severity } from "@prisma/client";
import { isDxdiag, isMedia, templateTitle, type History, type TemplateBug } from "@/lib/bug-template";
import { AE_SCALE, type SeverityScale } from "@/lib/severity";
import { AddMenu, FileTicks, type BugCapture, type BugFile } from "./bug-files";
import { cx, Input, Select, Textarea } from "./ui";

export type TemplateOptions = { clients: string[]; team: string[]; olyEnv: string[] };
type File_ = BugFile;

const Auto = ({ children }: { children: string }) => <span className="ml-1.5 rounded bg-accent-50 px-1.5 py-px text-[11px] font-medium text-accent-700">{children}</span>;

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
function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
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
const REPRO_CLIENTS = ["Web", "Unity", "Unreal"];

/**
 * Carry a numbered list for the typist: Enter after "3. foo" starts "4. ",
 * Enter on an empty "4. " ends the list, and the numbers below renumber. Plain
 * text is left to the textarea.
 */
function autoNumber(e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void) {
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

const HISTORY: { key: keyof History; label: string; rows: number; auto?: string; wide?: boolean }[] = [
  { key: "dateTime", label: "Date & time", rows: 2, auto: "now" },
  { key: "client", label: "Client", rows: 2, auto: "run build" },
  { key: "csp", label: "CSP", rows: 2, auto: "run CSP" },
  { key: "context", label: "Context", rows: 4, auto: "remembered", wide: true },
  { key: "user", label: "User name & ID", rows: 3, auto: "remembered", wide: true },
  { key: "envTenant", label: "Env & tenant", rows: 3, auto: "run env" },
  { key: "repros", label: "Repros", rows: 1 },
];

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
}) {
  const set = <K extends keyof TemplateBug>(k: K, v: TemplateBug[K]) => setBug((b) => ({ ...b, [k]: v }));
  const setH = (k: keyof History, v: string) =>
    setBug((b) => ({
      ...b,
      history: { ...b.history, [k]: v },
      // Repro Rate follows Repros until it's changed by hand.
      ...(k === "repros" && b.reproRate === b.history.repros ? { reproRate: v } : {}),
    }));
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
    <div className="space-y-5" data-testid="bug-template">
      <div className="space-y-2">
        <Section>TITLE</Section>
        <div className="grid gap-2.5 sm:grid-cols-[150px_200px_minmax(0,1fr)]">
          <div>
            <L htmlFor="t-tag" auto="from run">
              Client(s)
            </L>
            <Input id="t-tag" value={bug.clientTag} onChange={(e) => set("clientTag", e.target.value.toUpperCase())} />
          </div>
          <div>
            <L htmlFor="t-feature" auto="from case">
              Feature
            </L>
            <Input id="t-feature" value={bug.feature} onChange={(e) => set("feature", e.target.value)} />
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
            <L htmlFor="t-observed" auto="from run">
              Issue observed on
            </L>
            <Input id="t-observed" value={bug.observedOn} onChange={(e) => set("observedOn", e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">
              Clients needed for repro<Auto>from run</Auto>
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
          <L htmlFor="t-what" auto="your Actual result">
            What happened
          </L>
          <Textarea id="t-what" rows={3} value={bug.what} onChange={(e) => set("what", e.target.value)} />
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
        <Section note="filled in for you, edit anything">REPRODUCTION HISTORY</Section>
        <div className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
          {HISTORY.map((h) => (
            <div key={h.key} className={cx(h.wide && "sm:col-span-2")}>
              <L htmlFor={`h-${h.key}`} auto={h.auto}>
                {h.label}
              </L>
              <Textarea id={`h-${h.key}`} rows={h.rows} value={bug.history[h.key]} onChange={(e) => setH(h.key, e.target.value)} className="text-[13px]" />
            </div>
          ))}
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Attachments</p>
            <p className="py-1 text-[13px] text-slate-700">{listed ? `${listed} file${listed === 1 ? "" : "s"}, linked` : "None"}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Context and User name &amp; ID are yours to type. Whatever you use is remembered for this client and filled in next time; change it whenever your
          machine or account changes.
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
            className="font-mono text-[12.5px]"
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
            <Input id="t-rate" value={bug.reproRate} onChange={(e) => set("reproRate", e.target.value)} />
          </div>
          <div>
            <L htmlFor="t-impact">Bug impact</L>
            <Textarea id="t-impact" rows={2} value={bug.impact} onChange={(e) => set("impact", e.target.value)} placeholder="Who is hurt, how badly" />
          </div>
          <div>
            <L htmlFor="t-workaround">Bug workaround</L>
            <Textarea id="t-workaround" rows={2} value={bug.workaround} onChange={(e) => set("workaround", e.target.value)} placeholder="None known" />
          </div>
        </div>
        <div>
          <L htmlFor="t-build" auto="from run">
            Build #
          </L>
          <Input id="t-build" value={bug.build} onChange={(e) => set("build", e.target.value)} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">
            Client/SKUs<Auto>test cycle default</Auto>
          </p>
          <Chips label="Client/SKUs" options={options.clients} value={bug.clients} onChange={(v) => set("clients", v)} />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <L htmlFor="t-team" auto="test cycle default">
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
              Oly Environment<Auto>from run env</Auto>
            </p>
            <Chips label="Oly Environment" options={options.olyEnv} value={bug.olyEnv} onChange={(v) => set("olyEnv", v)} />
          </div>
        </div>
      </div>
    </div>
  );
}
