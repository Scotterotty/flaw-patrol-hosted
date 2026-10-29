"use client";

import { createContext, useContext, type ReactNode } from "react";
import { spell, type Spelling } from "@/lib/spelling";

const SpellingContext = createContext<Spelling>("us");

/** Set once in the root layout from the signed-in person's Language choice. */
export function SpellingProvider({ spelling, children }: { spelling: Spelling; children: ReactNode }) {
  return <SpellingContext.Provider value={spelling}>{children}</SpellingContext.Provider>;
}

export const useSpelling = () => useContext(SpellingContext);

/** Returns a function that shows the app's American text the way the reader prefers. */
export function useSpell() {
  const s = useSpelling();
  return (text: string) => spell(text, s);
}

/** App text with American spellings in it, e.g. <Sp>Accent color</Sp>. Works in server components too. */
export function Sp({ children }: { children: string }) {
  return <>{spell(children, useSpelling())}</>;
}
