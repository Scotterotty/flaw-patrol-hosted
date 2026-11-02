"use client";

import { createContext, useContext, type ReactNode } from "react";
import { spell, type Spelling } from "@/lib/spelling";

const SpellingContext = createContext<Spelling>("us");
const ZoneContext = createContext<string>("UTC");

/** Set once in the root layout from the signed-in person's Language choice and their browser's time zone (ver_137). */
export function SpellingProvider({ spelling, zone = "UTC", children }: { spelling: Spelling; zone?: string; children: ReactNode }) {
  return (
    <SpellingContext.Provider value={spelling}>
      <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>
    </SpellingContext.Provider>
  );
}

export const useSpelling = () => useContext(SpellingContext);
/**
 * The viewer's time zone (ver_137): the same on the server and in the browser, so a date drawn
 * in a client component doesn't change as the page loads (React error #418).
 */
export const useZone = () => useContext(ZoneContext);

/** Returns a function that shows the app's American text the way the reader prefers. */
export function useSpell() {
  const s = useSpelling();
  return (text: string) => spell(text, s);
}

/** App text with American spellings in it, e.g. <Sp>Accent color</Sp>. Works in server components too. */
export function Sp({ children }: { children: string }) {
  return <>{spell(children, useSpelling())}</>;
}
