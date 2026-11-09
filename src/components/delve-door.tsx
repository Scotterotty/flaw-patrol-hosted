"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// A hidden door on quest maps: Up Up Down Down Left Right Left Right B A, then Shift twice.
// Never while typing in a field. Nothing shows on the page.
const CODE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a", "shift", "shift"];

export const typingIn = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest("[contenteditable=''],[contenteditable='true']"));

/** How far along the code `keys` gets, starting over on a wrong key (which may itself start the code). */
export function codeStep(at: number, key: string) {
  const k = key.toLowerCase();
  if (CODE[at] === k) return at + 1;
  return CODE[0] === k ? 1 : 0;
}

export function DelveDoor() {
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    let at = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      if (typingIn(e.target)) {
        at = 0;
        return;
      }
      at = codeStep(at, e.key);
      if (at === CODE.length) {
        at = 0;
        router.push(`/delve?from=${encodeURIComponent(path)}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, path]);
  return null;
}
