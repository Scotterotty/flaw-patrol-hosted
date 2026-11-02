import { z } from "zod";

// Exploratory testing. A charter is a test case of type EXPLORATORY: instead of
// steps it has a mission ("Explore <area> with <resources> to discover <info>")
// and a time box. Running one is a session: a timer and a log of what the
// tester tried and found, saved to the run like any other result.

/**
 * A reminder that goes off during a session, by the session clock: every
 * `sec` seconds when `repeat`, otherwise once when the clock reaches `sec`.
 */
export const reminderSchema = z.object({
  id: z.string().max(40),
  repeat: z.boolean(),
  sec: z.number().int().min(60).max(480 * 60),
  text: z.string().trim().max(200).default(""),
});
export type Reminder = z.output<typeof reminderSchema>;
export const MAX_REMINDERS = 10;

export const charterSchema = z.object({
  explore: z.string().trim().max(2000).default(""),
  with: z.string().trim().max(2000).default(""),
  discover: z.string().trim().max(2000).default(""),
  minutes: z.number().int().min(5).max(480).default(60),
  reminders: z.array(reminderSchema).max(MAX_REMINDERS).default([]),
  /** Things to try, from a tour or checklist. Ticking one in a session logs "Covered". */
  prompts: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
});
export type Charter = z.output<typeof charterSchema>;

export const BLANK_CHARTER: Charter = { explore: "", with: "", discover: "", minutes: 60, reminders: [], prompts: [] };

/** How many times a reminder has gone off by `elapsed` seconds into the session. */
export function reminderCount(r: Reminder, elapsed: number) {
  return r.repeat ? Math.floor(elapsed / r.sec) : elapsed >= r.sec ? 1 : 0;
}

/** When it next goes off, in session seconds, or null once a one-off has gone. */
export function nextReminderAt(r: Reminder, elapsed: number) {
  if (r.repeat) return (Math.floor(elapsed / r.sec) + 1) * r.sec;
  return elapsed < r.sec ? r.sec : null;
}

/** "Every 15 min" or "At 23:00". */
export function reminderLabel(r: Reminder) {
  return r.repeat ? `Every ${Math.round(r.sec / 60)} min` : `At ${clock(r.sec)}`;
}
export const TIME_BOXES = [15, 30, 45, 60, 90, 120];

export function parseCharter(json: unknown): Charter {
  const parsed = charterSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : BLANK_CHARTER;
}

/** The charter as one sentence, the way charters are usually written. */
export function missionLine(c: Charter) {
  const parts = [c.explore && `Explore ${c.explore}`, c.with && `with ${c.with}`, c.discover && `to discover ${c.discover}`].filter(Boolean);
  return parts.length ? `${parts.join(" ")}.` : "";
}

export const NOTE_KINDS = ["note", "bug", "question", "idea"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** What a log line can be: a note kind, or a prompt someone ticked. */
export const LOG_KINDS = [...NOTE_KINDS, "covered"] as const;
export type LogKind = (typeof LOG_KINDS)[number];
export const NOTE_LABEL: Record<LogKind, string> = { note: "Note", bug: "Bug", question: "Question", idea: "Idea", covered: "Covered" };

const linkedDefect = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string().max(300),
  externalKey: z.string().max(100).nullable(),
  externalUrl: z.string().max(1000).nullable(),
  status: z.string().max(50),
});

/** One line in a session's log. `at` is seconds into the session. */
export const sessionNoteSchema = z.object({
  id: z.string().max(40),
  at: z.number().int().min(0).max(86400 * 7),
  kind: z.enum(LOG_KINDS),
  text: z.string().max(10000),
  attachments: z.array(z.object({ id: z.string(), fileName: z.string().max(300), contentType: z.string().max(200) })).max(20).default([]),
  defect: linkedDefect.nullable().default(null),
});
export type SessionNote = z.output<typeof sessionNoteSchema>;
export const sessionLogSchema = z.array(sessionNoteSchema).max(500);

export function parseSessionLog(json: unknown): SessionNote[] {
  const parsed = sessionLogSchema.safeParse(json ?? []);
  return parsed.success ? parsed.data : [];
}

/** How many of each kind of note, for summaries. */
export function noteCounts(notes: SessionNote[]) {
  const counts: Record<NoteKind, number> = { note: 0, bug: 0, question: 0, idea: 0 };
  for (const n of notes) if (n.kind !== "covered") counts[n.kind]++;
  return counts;
}

/** 0:00 style, or 1:02:03 past an hour. */
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type PersonaInfo = { name: string; emoji: string; description: string };

export function parsePersona(json: unknown): PersonaInfo | null {
  const parsed = z.object({ name: z.string(), emoji: z.string(), description: z.string() }).safeParse(json);
  return parsed.success ? parsed.data : null;
}
