"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Case versions saved in this tab (ver_120). Save no longer reloads every page, so the browser can
 * show a case page or editor it remembers from before the save; seeing an older version, it reloads.
 */
const savedHere = new Map<string, number>();

export function noteSavedVersion(caseId: string, version: number) {
  savedHere.set(caseId, Math.max(version, savedHere.get(caseId) ?? 0));
}

export function useFreshVersion(caseId: string | undefined | null, version: number | null | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (caseId && version != null && (savedHere.get(caseId) ?? 0) > version) router.refresh();
  }, [caseId, version, router]);
}

/** On a case's page: reloads it once if this tab saved a newer version than the one shown. */
export function FreshVersion({ caseId, version }: { caseId: string; version: number }) {
  useFreshVersion(caseId, version);
  return null;
}
