// Seasonal quest maps: the map's scenery dresses up for the time of year.
// Weather, nature and fun only, nothing religious. The look comes from the day the
// run started, so an old run keeps its season. Same dates for everyone (UTC).

export type SeasonId = "spring" | "summer" | "fall" | "halloween" | "winter" | "lights";

export const SEASON_INFO: Record<SeasonId, { name: string; icon: string; when: string }> = {
  spring: { name: "Spring", icon: "🌷", when: "Mar 1 – May 31" },
  summer: { name: "Summer", icon: "🌻", when: "Jun 1 – Aug 31" },
  fall: { name: "Fall", icon: "🍂", when: "Sep 1 – Nov 30" },
  halloween: { name: "Halloween", icon: "🎃", when: "Oct 15 – Oct 31" },
  winter: { name: "Winter", icon: "⛄", when: "Dec 1 – Feb 28" },
  lights: { name: "Winter lights", icon: "✨", when: "Dec 15 – Jan 1" },
};

/** Which look a map started on this day gets. Halloween and Winter lights sit on top of Fall and Winter. */
export function seasonFor(date: Date): SeasonId {
  const md = (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  if (md >= 1215 || md <= 101) return "lights";
  if (md >= 1201 || md <= 229) return "winter";
  if (md <= 531) return "spring";
  if (md <= 831) return "summer";
  if (md >= 1015 && md <= 1031) return "halloween";
  return "fall";
}
