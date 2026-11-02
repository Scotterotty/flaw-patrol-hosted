// Close run asks first when cases still need a result (ver_137): how many, and whose lists they
// come off, so a lead closing at sprint end sees who is affected before the work disappears.

/** "Mia Member's list", "Mia Member's and Lee Lead's lists", "3 people's lists". */
export function whoseLists(names: string[]) {
  const n = [...new Set(names.filter(Boolean))];
  if (!n.length) return "";
  if (n.length === 1) return `${n[0]}'s list`;
  if (n.length === 2) return `${n[0]}'s and ${n[1]}'s lists`;
  return `${n.length} people's lists`;
}

/** The line under "5 of 8 cases haven't been tested." */
export function closeRunNote(names: string[]) {
  const lists = whoseLists(names);
  return `${lists ? `They come off ${lists} and stay` : "They stay"} Untested in reports. You can reopen the run later.`;
}

export const untestedLine = (open: number, total: number) => `${open} of ${total} ${total === 1 ? "case hasn't" : "cases haven't"} been tested.`;
