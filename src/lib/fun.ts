// Hosted build (backend review §4: "Non-QA features add attack surface ... Put them behind a
// feature flag ... for an org deploy"). FUN_FEATURES=off on the server hides the mini game
// (XP, levels, titles, leaderboard), quest maps and the radio with Spotify for everyone, and
// refuses turning them on. Nothing is deleted: set it back and everyone's progress returns.
// IT (or CHS, through IT) can flip it in an emergency; the company server starts with it off.

/** True when the server has the fun features switched off. */
export function funOff(env: string | undefined = process.env.FUN_FEATURES): boolean {
  return /^(off|false|0|no)$/i.test(env?.trim() ?? "");
}

export const FUN_OFF_MESSAGE = "Mini game and radio are switched off on this server.";

/** A person as the app should treat them: with the fun switched off, nobody plays or listens. */
export function withFun<T extends { gameEnabled?: boolean; radioEnabled?: boolean; questMap?: boolean }>(user: T): T {
  if (!funOff()) return user;
  return { ...user, gameEnabled: false, radioEnabled: false, questMap: false };
}
