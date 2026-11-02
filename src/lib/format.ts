import type { CaseType, Priority } from "@prisma/client";
import { longDate, type Spelling } from "./spelling";

export const caseKey = (projectKey: string, number: number) => `${projectKey}-${number}`;

export const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
export const PRIORITY_LABEL: Record<Priority, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
export const TYPE_LABEL: Record<CaseType, string> = { MANUAL: "Manual", AUTOMATED: "Automated", EXPLORATORY: "Charter" };

/** "5 min ago", "3 d ago", then a date after a month (Oct 24, 2026 or 24 Oct 2026). */
export function relativeTime(date: Date, spelling: Spelling = "us", now = new Date()): string {
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return longDate(date, spelling);
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 30);
}

/** "1 result", "2 results": a count with its word, never "1 results" (ver_54 audit #10). */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whole minutes for a time spent, but "under 1 min" for a few seconds instead of "0 min" (ver_54 audit #11). */
export function minutesSpent(sec: number): string {
  if (sec > 0 && sec < 60) return "under 1 min";
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
