// The invite page's title (ver_137): who invited you, and to what, so a new person
// knows the link is real. "Demo Admin invited you to Mobile App", "… Mobile App and 2 more".

/** The umbrellas (or test cycles outside one) someone was invited to, once each, in order. */
export function inviteTitle(inviter: string | null | undefined, places: string[]) {
  const names = [...new Set(places.map((p) => p.trim()).filter(Boolean))];
  const who = inviter?.trim();
  if (!who || !names.length) return "You're invited to Flaw Patrol";
  const to = names.length === 1 ? names[0] : `${names[0]} and ${names.length - 1} more`;
  return `${who} invited you to ${to}`;
}
