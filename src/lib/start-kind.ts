// Start a run's kinds (ver_95) hand off to the boxes that already exist: picking
// Release candidate opens the release box, Bug bash the bug bash box. The box listens
// on the page; when nothing on the page does, the caller goes to a page that does.

const EVENT = "fp:start-kind";

/** Listen for a kind being picked. Returns the cleanup, for useEffect. */
export function onStartKind(kind: "rc" | "bash", open: () => void) {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<{ kind: string; handled: boolean }>).detail;
    if (d.kind !== kind) return;
    d.handled = true;
    open();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Ask the page to open a kind's box; false when nothing here can. */
export function startKind(kind: "rc" | "bash") {
  const detail = { kind, handled: false };
  window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  return detail.handled;
}
