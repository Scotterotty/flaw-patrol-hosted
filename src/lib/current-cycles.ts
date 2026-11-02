/** The fields that decide whether a test cycle is current. */
export type CycleForSplit = { platform: string; name: string; keepCurrent: boolean };

/**
 * Split an umbrella's test cycles into Current and Older. `cycles` come newest first.
 * The newest live cycle for each platform is current; cycles without a platform always are;
 * a cycle pinned with Keep in Current stays current and doesn't take its platform's spot.
 * Cycles that aren't live (archived) are always older.
 */
export function splitCycles<T extends CycleForSplit>(cycles: T[], live: (c: T) => boolean, platformOrder: string[]) {
  const seen = new Set<string>();
  const current: T[] = [];
  const older: T[] = [];
  for (const c of cycles) {
    const k = c.platform.toLowerCase();
    if (!live(c)) older.push(c);
    else if (c.keepCurrent) current.push(c);
    else if (k && seen.has(k)) older.push(c);
    else {
      if (k) seen.add(k);
      current.push(c);
    }
  }
  const lower = platformOrder.map((p) => p.toLowerCase());
  const order = (c: T) => {
    const i = lower.indexOf(c.platform.toLowerCase());
    return i < 0 ? 99 : i;
  };
  // By platform; within a platform the release cycle first, then pinned ones, then by name.
  current.sort((a, b) => order(a) - order(b) || Number(a.keepCurrent) - Number(b.keepCurrent) || a.name.localeCompare(b.name));
  return { current, older };
}
