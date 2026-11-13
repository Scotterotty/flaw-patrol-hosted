/**
 * Numbered steps typed on one line ("1. Log in. 2. Add an entity. 3. …") as one
 * step each (ver_231). Jira bugs often hold repro steps that way; shown as typed
 * they read as one long paragraph. Steps must start at 1 and count up by one, so
 * a number out of order inside a step ("set volume to 9.") never splits it.
 * Returns null when the text isn't a numbered list of at least two steps.
 */
export function splitNumberedSteps(text: string): string[] | null {
  const t = text.trim();
  const first = /^1([.)])\s+/.exec(t);
  if (!first) return null;
  const mark = first[1] === "." ? "\\." : "\\)";
  const steps: string[] = [];
  let start = first[0].length;
  for (let n = 2; ; n++) {
    const next = new RegExp(`\\s${n}${mark}\\s+`, "g");
    next.lastIndex = start;
    const m = next.exec(t);
    if (!m) break;
    steps.push(t.slice(start, m.index).trim());
    start = m.index + m[0].length;
  }
  steps.push(t.slice(start).trim());
  if (steps.length < 2 || steps.some((s) => !s)) return null;
  return steps;
}
