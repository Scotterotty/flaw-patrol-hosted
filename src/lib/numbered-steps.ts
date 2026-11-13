/**
 * Numbered steps typed on one line ("1. Log in. 2. Add an entity. 3. …") as one
 * step each (ver_231). Jira bugs often hold repro steps that way; shown as typed
 * they read as one long paragraph. Steps must start at 1 and count up by one, so
 * a number out of order inside a step ("set volume to 9.") never splits it.
 * Returns null when the text isn't a numbered list of at least two steps.
 */
export function splitNumberedSteps(text: string): string[] | null {
  const t = text.trim();
  // Accept the common ways people number steps: "1." "1)" "1)." "1.)"
  // "1:" "1 -" and "Step 1:" style. Every later step must use the same style.
  const first = /^(step\s*)?1(\s*-|\)\.|\.\)|[.):])\s+/i.exec(t);
  if (!first) return null;
  const word = first[1] ? "step\\s*" : "";
  const mark = first[2].includes("-") ? "\\s*-" : first[2].replace(/[.)]/g, "\\$&");
  const steps: string[] = [];
  let start = first[0].length;
  for (let n = 2; ; n++) {
    const next = new RegExp(`\\s${word}${n}${mark}\\s+`, "gi");
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
