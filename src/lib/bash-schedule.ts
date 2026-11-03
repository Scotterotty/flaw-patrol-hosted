import { clock } from "./charter";

// Scheduled bug bashes (ver_153): a bash set up days ahead. The moment is stored as one
// instant; everyone sees it on their own clock, and the calendar file carries it in UTC
// so Outlook, Google and Apple put it at the right local time for each person.

/** The latest a bash can be scheduled: a year out. */
export const MAX_AHEAD_MS = 366 * 24 * 3600_000;

/** "Starts in 2 days", "Starts in 1 day", else the clock ("Starts in 3:12:40"). */
export function startsIn(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  if (s >= 2 * 86_400) return `${Math.floor(s / 86_400)} days`;
  if (s >= 86_400) return "1 day";
  return clock(s);
}

/** "Thu, Nov 6 · 10:00 AM PST" on the viewer's clock. */
export function whenLabel(iso: string | Date, zone: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
    timeZoneName: "short",
  });
  return `${day} · ${time}`;
}

/** A date box (2026-11-06) and a time box (10:00) as one instant on this browser's clock. */
export function localInstant(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${day}T${time}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The date and time boxes' values for an instant, on this browser's clock. */
export function localBoxes(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** The next whole hour from now: the time box's starting value. */
export function nextHour(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** Why a picked start time won't do, or null when it's fine. */
export function startProblem(at: Date | null, now = new Date()) {
  if (!at) return "Pick a date and a time.";
  if (at.getTime() <= now.getTime()) return "That time has already passed. Pick a later one, or start it now.";
  if (at.getTime() - now.getTime() > MAX_AHEAD_MS) return "Pick a time within the next year.";
  return null;
}

const icsTime = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
/** Calendar text: backslash, comma, semicolon and new lines escaped; long lines folded. */
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Lines over 75 bytes continue on the next line after a space (the calendar format's rule). */
function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > 74) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** A calendar invite (.ics) for a bug bash, with its Join link. */
export function bashIcs(
  b: {
    id: string;
    name: string;
    startsAt: string | Date;
    endsAt: string | Date;
    areas: string[];
    url: string;
    by: string;
  },
  now = new Date(),
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Flaw Patrol//Bug bash//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:bash-${b.id}@flaw-patrol`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(new Date(b.startsAt))}`,
    `DTEND:${icsTime(new Date(b.endsAt))}`,
    `SUMMARY:${icsText(`Bug bash · ${b.name}`)}`,
    `DESCRIPTION:${icsText(`Join here: ${b.url}\n\nAreas: ${b.areas.join(", ")}\nSet up by ${b.by} in Flaw Patrol.`)}`,
    `URL:${icsText(b.url)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(`Bug bash · ${b.name} starts in 10 minutes`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A file name for the invite: "bug-bash-checkout-2-4.ics". */
export function icsFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `bug-bash${slug ? `-${slug}` : ""}.ics`;
}
