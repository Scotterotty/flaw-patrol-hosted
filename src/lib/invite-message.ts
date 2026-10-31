// The message an admin pastes into Slack, Teams or an email when an invite isn't emailed
// (ver_114). The same words come from Add and from Copy invite link, so people see one message.

export const INVITE_LINK_DAYS = 7;

export function inviteMessage(place: string, url: string) {
  return `You're invited to ${place} in Flaw Patrol. Open this link to choose your password and sign in: ${url} (works once, for ${INVITE_LINK_DAYS} days)`;
}

/** "Nov 7": when an invite link runs out, in the viewer's own time zone. */
export function linkUntil(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
