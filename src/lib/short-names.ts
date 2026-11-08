/**
 * Short names for the run list (ver_200): first names, never initials. Your own cases say "You".
 * When two people share a first name, both get their last initial too, like "Sam T." and "Sam K.".
 */
export function shortNames(people: { id: string; name: string }[], meId: string): Map<string, string> {
  const first = (n: string) => {
    const t = n.trim();
    // No name yet: the part of the email before the @.
    const base = t.includes("@") && !t.includes(" ") ? t.split("@")[0] : t;
    return base.split(/\s+/)[0] || base;
  };
  const count = new Map<string, number>();
  for (const p of people) {
    const f = first(p.name).toLowerCase();
    count.set(f, (count.get(f) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const p of people) {
    if (p.id === meId) {
      out.set(p.id, "You");
      continue;
    }
    const f = first(p.name);
    const words = p.name.trim().split(/\s+/);
    const last = words.length > 1 && !p.name.includes("@") ? words[words.length - 1][0]?.toUpperCase() : "";
    out.set(p.id, (count.get(f.toLowerCase()) ?? 0) > 1 && last ? `${f} ${last}.` : f);
  }
  return out;
}
