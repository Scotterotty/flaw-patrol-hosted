// Lets a screen with unsaved input pause live refreshes (see LiveRefresh), so
// someone else's change never wipes what you're typing. Browser-only.
let holds = 0;

/** Pause live refreshes until the returned function is called. */
export function holdLive() {
  holds++;
  let released = false;
  return () => {
    if (!released) holds--;
    released = true;
  };
}

export const liveHeld = () => holds > 0;
