// US or UK English for the app's own words and dates (Account > Language).
// The app is written in American English; British readers get the words below swapped
// as the text is shown. What people type (cases, steps, comments, Jira bugs) is never changed.

export type Spelling = "us" | "uk";

export const SPELLINGS: { id: Spelling; label: string; sample: string }[] = [
  { id: "us", label: "US English", sample: "color · organize · canceled · Oct 24, 2026" },
  { id: "uk", label: "UK English", sample: "colour · organise · cancelled · 24 Oct 2026" },
];

export const isSpelling = (v: unknown): v is Spelling => v === "us" || v === "uk";

/** Your own pick, or US English when you haven't picked. */
export const spellingFor = (mine: string | null | undefined): Spelling => (isSpelling(mine) ? mine : "us");

// Whole words only, lower case; capitalized and ALL CAPS forms follow automatically.
const WORDS: Record<string, string> = {
  license: "licence",
  defense: "defence",
  offense: "offence",
  fulfill: "fulfil",
  fulfillment: "fulfilment",
  enroll: "enrol",
  enrollment: "enrolment",
  skeptical: "sceptical",
  judgment: "judgement",
  unauthorized: "unauthorised",
  cancelation: "cancellation",
};
// color → colour, colors, colored, coloring, colorful…
for (const w of ["color", "favorite", "honor", "armor", "behavior", "neighbor", "labor", "flavor", "humor", "rumor", "vapor"])
  for (const e of ["", "s", "ed", "ing", "ful", "less", "able"]) WORDS[w + e] = w.replace(/or$/, "our") + e;
for (const e of ["", "s", "ed", "ing", "ish", "ness"]) WORDS[`gray${e}`] = `grey${e}`;
// center → centre, centred, centring
for (const w of ["center", "theater", "fiber", "caliber", "liter"]) {
  const uk = w.replace(/er$/, "re");
  Object.assign(WORDS, { [w]: uk, [`${w}s`]: `${uk}s`, [`${w}ed`]: `${uk}d`, [`${w}ing`]: `${uk.slice(0, -1)}ing` });
}
for (const w of ["catalog", "dialog"]) Object.assign(WORDS, { [w]: `${w}ue`, [`${w}s`]: `${w}ues` });
// organize → organise, organized, organization…; analyze → analyse
for (const w of ["organiz", "recogniz", "normaliz", "summariz", "customiz", "prioritiz", "authoriz", "finaliz", "personaliz", "optimiz", "minimiz",
  "maximiz", "categoriz", "visualiz", "realiz", "apologiz", "emphasiz", "utiliz", "synchroniz", "initializ", "standardiz", "memoriz", "criticiz",
  "characteriz", "analyz", "paralyz"])
  for (const e of ["e", "es", "ed", "ing", "er", "ers", "ation", "ations"]) WORDS[w + e] = w.slice(0, -1) + "s" + e;
// canceled → cancelled
for (const w of ["cancel", "label", "travel", "model", "level", "fuel", "signal", "total", "channel", "dial"])
  for (const e of ["ed", "ing"]) WORDS[w + e] = `${w}l${e}`;

const PATTERN = new RegExp(`\\b(${Object.keys(WORDS).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");

function matchCase(from: string, to: string) {
  if (from === from.toUpperCase() && from.length > 1) return to.toUpperCase();
  if (from[0] === from[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

/** The app's American text as the reader prefers it. */
export function spell(text: string, spelling: Spelling): string {
  if (spelling !== "uk" || !text) return text;
  return text.replace(PATTERN, (w) => matchCase(w, WORDS[w.toLowerCase()]));
}

const locale = (s: Spelling) => (s === "uk" ? "en-GB" : "en-US");
// An optional time zone (ver_137): the viewer's, so server-drawn times aren't in the server's UTC.
const tz = (zone?: string) => (zone ? { timeZone: zone } : {});

/** Oct 24, 2026 or 24 Oct 2026. */
export const longDate = (d: Date, s: Spelling, zone?: string) => d.toLocaleDateString(locale(s), { year: "numeric", month: "short", day: "numeric", ...tz(zone) });
/** Oct 24 or 24 Oct. */
export const shortDate = (d: Date, s: Spelling, zone?: string) => d.toLocaleDateString(locale(s), { month: "short", day: "numeric", ...tz(zone) });
/** 10/24/2026, 3:05 PM or 24/10/2026, 15:05. */
export const dateTime = (d: Date, s: Spelling, zone?: string) => d.toLocaleString(locale(s), { dateStyle: "short", timeStyle: "short", ...tz(zone) });
/** 3:05 PM or 15:05. */
export const clockTime = (d: Date, s: Spelling, zone?: string) => d.toLocaleTimeString(locale(s), { hour: "numeric", minute: "2-digit", ...tz(zone) });
/** Sun, Nov 1 or Sun 1 Nov. */
export const dayName = (d: Date, s: Spelling, zone?: string) => d.toLocaleDateString(locale(s), { weekday: "short", month: "short", day: "numeric", ...tz(zone) });
/** Sep 27 – Oct 27, 2026 or 27 Sep – 27 Oct 2026, for report date ranges (UTC days, like the date boxes). */
export const dateRange = (from: Date, to: Date, s: Spelling) =>
  new Intl.DateTimeFormat(locale(s), { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).formatRange(from, to);
