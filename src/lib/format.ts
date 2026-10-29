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
