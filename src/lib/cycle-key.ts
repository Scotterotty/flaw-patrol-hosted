/** "Sprint 14" → "S1", "Smoke" → "SMOKE": a key from a test cycle's name (the first letters, or the one word). */
export function keyFromName(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  return key.replace(/^[0-9]+/, "").slice(0, 10);
}

/**
 * Keys to try for a test cycle made without asking for one (+ New test cycle in
 * Pull from GitHub): the umbrella's key and the name's letters, like OKOBH, then OKOBH2, OKOBH3…
 */
export function keyCandidates(umbrellaKey: string, name: string, count = 30): string[] {
  let base = `${umbrellaKey}${keyFromName(name)}`.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "");
  if (base.length < 2) base = `${base}TC`.slice(0, 10);
  base = base.slice(0, 10);
  const out = [base];
  for (let i = 2; out.length < count; i++) out.push(`${base.slice(0, 10 - String(i).length)}${i}`);
  return out;
}
