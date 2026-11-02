import { clock, reminderLabel, NOTE_KINDS, NOTE_LABEL, noteCounts, type Charter, type PersonaInfo, type SessionNote } from "@/lib/charter";
import { GlossaryText } from "./glossary";
import { cx } from "./ui";

/** A persona as a small chip: icon and name, with what they're like on hover. */
export function PersonaChip({ persona, className }: { persona: PersonaInfo; className?: string }) {
  return (
    <span
      title={persona.description || undefined}
      className={cx("inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200 ring-inset", className)}
    >
      <span aria-hidden>{persona.emoji}</span>
      <span>
        <span className="sr-only">Persona: </span>
        {persona.name}
      </span>
    </span>
  );
}

export function timeBoxLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`;
}

/** A charter's mission laid out as Explore / With / To discover / Time limit. */
/** hideReminders: during a session they're in the Timer panel already, so they show once (ver_54 audit #2). */
export function CharterView({ charter, persona, className, hidePrompts, hideReminders }: { charter: Charter; persona?: PersonaInfo | null; className?: string; hidePrompts?: boolean; hideReminders?: boolean }) {
  const rows: [string, string][] = [
    ["Explore", charter.explore],
    ["With", charter.with],
    ["To discover", charter.discover],
  ];
  return (
    <dl className={cx("grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className={cx("whitespace-pre-wrap wrap-anywhere", v ? "text-slate-800" : "text-slate-400")}>{v ? <GlossaryText text={v} /> : "Not set"}</dd>
        </div>
      ))}
      <dt className="text-xs font-medium text-slate-500">Time limit</dt>
      <dd className="text-slate-800">{timeBoxLabel(charter.minutes)}</dd>
      {charter.reminders.length > 0 && !hideReminders && (
        <>
          <dt className="text-xs font-medium text-slate-500">Reminders</dt>
          <dd>
            <ul className="space-y-0.5 text-slate-800">
              {charter.reminders.map((r) => (
                <li key={r.id}>
                  ⏰ {reminderLabel(r)}
                  {r.text && <span className="text-slate-600"> · {r.text}</span>}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {charter.prompts.length > 0 && !hidePrompts && (
        <>
          <dt className="text-xs font-medium text-slate-500">Prompts</dt>
          <dd>
            <ul className="space-y-0.5 text-slate-800">
              {charter.prompts.map((p) => (
                <li key={p}>☐ {p}</li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {persona && (
        <>
          <dt className="text-xs font-medium text-slate-500">Persona</dt>
          <dd>
            <PersonaChip persona={persona} />
            {persona.description && <span className="mt-0.5 block text-xs text-slate-500">{persona.description}</span>}
          </dd>
        </>
      )}
    </dl>
  );
}

const KIND_TEXT: Record<SessionNote["kind"], string> = { note: "text-slate-500", bug: "text-red-700", question: "text-amber-700", idea: "text-emerald-700", covered: "text-accent-700" };

/** A saved session's log, folded away until opened. */
export function SessionLogDetails({ notes, elapsedSec }: { notes: SessionNote[]; elapsedSec: number | null }) {
  if (!notes.length) return null;
  const c = noteCounts(notes);
  const parts = NOTE_KINDS.filter((k) => c[k]).map((k) => `${c[k]} ${NOTE_LABEL[k].toLowerCase()}${c[k] === 1 ? "" : "s"}`);
  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-accent-700 hover:underline">
        Session log{elapsedSec !== null && ` · ${clock(elapsedSec)}`} · {parts.join(", ")}
      </summary>
      <ol className="mt-1 space-y-1 border-l-2 border-slate-200 pl-2">
        {notes.map((n) => (
          <li key={n.id} className="flex gap-2">
            <span className="w-10 shrink-0 text-slate-400 tabular-nums">{clock(n.at)}</span>
            <span className={cx("w-14 shrink-0 font-semibold uppercase", KIND_TEXT[n.kind])}>{NOTE_LABEL[n.kind]}</span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-slate-700">
              {n.text}
              {n.defect && <span className="ml-1 font-mono text-red-700">{n.defect.externalKey ?? `D-${n.defect.number}`}</span>}
              {n.attachments.map((a) => (
                <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="ml-1 text-accent-700 hover:underline">
                  📎 {a.fileName}
                </a>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
