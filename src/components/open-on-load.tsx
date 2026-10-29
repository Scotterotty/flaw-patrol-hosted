"use client";

import { useEffect } from "react";

/** Presses the button with this label once the page loads, so a link can open a dialog (like ?edit=1 for Edit group). */
export function OpenOnLoad({ label }: { label: string }) {
  useEffect(() => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
    button?.click();
    // Drop the flag so a refresh doesn't open it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", url);
  }, [label]);
  return null;
}
