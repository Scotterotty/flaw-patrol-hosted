import type { WrapUp } from "./wrap-ups";

// Wrap-ups as text for Copy for Confluence and spreadsheet exports (ver_96). Kept apart from
// wrap-ups.ts, which reads the database, so the browser can use it.

export const WRAP_HEADING = "Exploring and bug bashes";
export const WRAP_NOTE = "Not counted in pass rates";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "Scott · as 👶 First-time player · 42 of 60 min · 2 bugs, 3 notes, 1 question" */
export function wrapLine(w: Pick<WrapUp, "type" | "who" | "persona" | "minutes" | "limit" | "people" | "bugs" | "notes" | "questions">) {
  const finds = [w.bugs && plural(w.bugs, "bug"), w.notes && plural(w.notes, "note"), w.questions && plural(w.questions, "question")].filter(Boolean).join(", ") || "No issues";
  return w.type === "bash"
    ? [`${w.minutes} min`, plural(w.people, "person").replace("persons", "people"), finds].join(" · ")
    : [w.who, w.persona && `as ${w.persona}`, `${w.minutes} of ${w.limit} min`, finds].filter(Boolean).join(" · ");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The section as HTML for pasting into Confluence. `origin` makes the links absolute. */
export function wrapUpsHtml(items: WrapUp[], origin: string) {
  if (!items.length) return "";
  return [
    `<h3>${WRAP_HEADING} <span style="font-weight:normal;color:#64748b">· ${WRAP_NOTE}</span></h3>`,
    "<ul>",
    ...items.map(
      (w) =>
        `<li><a href="${esc(origin + w.href)}"><b>${esc(w.title)}</b></a> (${w.type === "bash" ? "🐞 Bug bash" : "🧭 Exploratory"}): ${esc(wrapLine(w))}${w.worst ? `<br/>Worst: ${esc(w.worst)}` : ""}${w.summary ? `<br/><i>&ldquo;${esc(w.summary)}&rdquo;</i>` : ""}</li>`,
    ),
    "</ul>",
  ].join("");
}

/** The section as rows, for CSV and Excel. */
export function wrapUpsRows(items: WrapUp[]): (string | number)[][] {
  if (!items.length) return [];
  return [[`${WRAP_HEADING} (${WRAP_NOTE.toLowerCase()})`, "Kind", "When", "Who", "Minutes", "Bugs", "Notes", "Questions", "Summary"], ...items.map((w) => [w.title, w.type === "bash" ? "Bug bash" : "Exploratory", w.at.slice(0, 16).replace("T", " "), w.type === "bash" ? `${w.people} people` : w.who, w.minutes, w.bugs, w.notes, w.questions, w.summary || w.worst])];
}

/** Plain text, for the clipboard's text copy. */
export function wrapUpsText(items: WrapUp[]) {
  if (!items.length) return "";
  return [`${WRAP_HEADING} (${WRAP_NOTE.toLowerCase()})`, ...items.map((w) => `- ${w.title}: ${wrapLine(w)}${w.summary ? ` "${w.summary}"` : ""}`)].join("\n");
}
