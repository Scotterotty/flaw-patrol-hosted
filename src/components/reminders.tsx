"use client";

import { useEffect, useRef, useState } from "react";
import { clock, MAX_REMINDERS, nextReminderAt, reminderCount, reminderLabel, type Reminder } from "@/lib/charter";
import { Button, Input, Select } from "./ui";

let seq = 0;
export const reminderId = () => `r${Date.now().toString(36)}${(++seq).toString(36)}`;
export const blankReminder = (): Reminder => ({ id: reminderId(), repeat: true, sec: 15 * 60, text: "" });

/** Rows of "Every / Once at · N min · what to do", for the charter editor and the session screen. */
export function ReminderRows({ reminders, onChange, idPrefix }: { reminders: Reminder[]; onChange: (r: Reminder[]) => void; idPrefix: string }) {
  const set = (i: number, patch: Partial<Reminder>) => onChange(reminders.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      {reminders.map((r, i) => (
        <div key={r.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 p-1.5" role="group" aria-label={`Reminder ${i + 1}`}>
          <Select className="w-auto" aria-label="Repeat" value={r.repeat ? "every" : "once"} onChange={(e) => set(i, { repeat: e.target.value === "every" })}>
            <option value="every">Every</option>
            <option value="once">Once at</option>
          </Select>
          <Input
            id={`${idPrefix}-min-${i}`}
            type="number"
            min={1}
            max={480}
            className="w-20"
            aria-label="Minutes"
            value={Math.round(r.sec / 60)}
            onChange={(e) => set(i, { sec: Math.min(480, Math.max(1, Math.round(Number(e.target.value) || 1))) * 60 })}
          />
          <span className="text-xs text-slate-500">{r.repeat ? "min" : "min into the session"}</span>
          <Input className="min-w-40 flex-1" aria-label="What to do" placeholder="What to do (optional)" maxLength={200} value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
          <button type="button" aria-label={`Remove reminder ${i + 1}`} className="px-1 text-slate-400 hover:text-slate-800" onClick={() => onChange(reminders.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      {reminders.length < MAX_REMINDERS && (
        <Button size="sm" onClick={() => onChange([...reminders, blankReminder()])} data-howto="add-reminder">
          + Add reminder
        </Button>
      )}
    </div>
  );
}

export type ReminderAlert = { key: string; reminder: Reminder; at: number };

const CHIME_KEY = "fp-reminder-chime";
const readChime = () => {
  try {
    return localStorage.getItem(CHIME_KEY) !== "off";
  } catch {
    return true;
  }
};

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.25].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.4);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // No sound is fine; the banner still shows.
  }
}

/**
 * Watches the session clock and raises an alert each time a reminder comes
 * due. Reminders already past when the screen opens (or when one is added)
 * don't go off, so resuming a session doesn't set off a pile of them.
 */
export function useReminderAlerts(reminders: Reminder[], elapsed: number) {
  const seen = useRef(new Map<string, number>());
  const [alerts, setAlerts] = useState<ReminderAlert[]>([]);
  const [sound, setSound] = useState(true);
  useEffect(() => setSound(readChime()), []);
  useEffect(() => {
    const fresh: ReminderAlert[] = [];
    for (const r of reminders) {
      const n = reminderCount(r, elapsed);
      const before = seen.current.get(r.id);
      seen.current.set(r.id, n);
      if (before !== undefined && n > before) fresh.push({ key: `${r.id}:${n}`, reminder: r, at: r.repeat ? n * r.sec : r.sec });
    }
    if (!fresh.length) return;
    setAlerts((a) => [...a, ...fresh].slice(-5));
    if (sound) chime();
  }, [reminders, elapsed, sound]);

  // While an alert is up, the tab title flashes so it shows from another window.
  useEffect(() => {
    if (!alerts.length) return;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `⏰ ${alerts[alerts.length - 1].reminder.text || "Reminder"}` : original;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [alerts]);

  const toggleSound = () => {
    setSound((s) => {
      try {
        localStorage.setItem(CHIME_KEY, s ? "off" : "on");
      } catch {
        // Only a convenience.
      }
      return !s;
    });
  };
  return { alerts, dismiss: (key: string) => setAlerts((a) => a.filter((x) => x.key !== key)), sound, toggleSound };
}

/** The alert banner shown when a reminder goes off. */
export function ReminderBanner({ alert, onLog, onDone }: { alert: ReminderAlert; onLog: () => void; onDone: () => void }) {
  return (
    <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <span className="text-xl" aria-hidden>
        ⏰
      </span>
      <p className="min-w-40 flex-1">
        <span className="font-semibold tabular-nums">{clock(alert.at)}</span>
        {" · "}
        {alert.reminder.text || reminderLabel(alert.reminder)}
      </p>
      <Button size="sm" onClick={onLog}>
        Log a note
      </Button>
      <Button size="sm" variant="primary" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** Under the session timer: the charter's reminders, plus any added for this session only. */
export function SessionReminders({
  charterReminders,
  own,
  onChange,
  elapsed,
  sound,
  onToggleSound,
  disabled,
}: {
  charterReminders: Reminder[];
  own: Reminder[];
  onChange: (r: Reminder[]) => void;
  elapsed: number;
  sound: boolean;
  onToggleSound: () => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const pill = (r: Reminder) => {
    const next = nextReminderAt(r, elapsed);
    return (
      <li key={r.id} className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 ring-inset">
        ⏰ {reminderLabel(r)}
        {r.text && ` · ${r.text}`}
        <span className="block text-slate-500 tabular-nums">{next === null ? "Done" : `Next at ${clock(next)}, in ${clock(next - elapsed)}`}</span>
      </li>
    );
  };
  return (
    <section aria-label="Reminders" className="mt-3 border-t border-slate-100 pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-slate-500">Reminders</h2>
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={onToggleSound} aria-pressed={sound} aria-label="Reminder sound">
          {sound ? "🔔 Sound on" : "🔕 Sound off"}
        </button>
      </div>
      {(charterReminders.length > 0 || (own.length > 0 && !editing)) && <ul className="mt-1.5 space-y-1">{[...charterReminders, ...(editing ? [] : own)].map(pill)}</ul>}
      {editing ? (
        <div className="mt-2">
          <ReminderRows idPrefix="session-reminder" reminders={own} onChange={onChange} />
          <Button size="sm" variant="primary" className="mt-1.5" onClick={() => setEditing(false)}>
            Done
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="mt-2"
          disabled={disabled}
          onClick={() => {
            if (!own.length) onChange([blankReminder()]);
            setEditing(true);
          }}
        >
          {own.length ? "Edit my reminders" : "⏰ Add reminder"}
        </Button>
      )}
    </section>
  );
}
