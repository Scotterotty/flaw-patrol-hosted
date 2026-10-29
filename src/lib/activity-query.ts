import type { Prisma } from "@prisma/client";

// Pure parts of the activity log (no database), so tests and pages can share them.

export const ACTIVITY_KINDS = {
  signin: "Sign-in",
  people: "People",
  settings: "Settings",
  delete: "Delete and archive",
  run: "Run",
} as const;
export type ActivityKind = keyof typeof ACTIVITY_KINDS;

export const KEEP_CHOICES = [
  [90, "90 days"],
  [180, "6 months"],
  [365, "1 year"],
  [730, "2 years"],
  [2555, "7 years"],
] as const;

export type ActivityFilters = { q?: string; who?: string; kind?: string; umbrella?: string; days?: string; limit?: string };

export const DAY_CHOICES = [
  ["1", "Last 24 hours"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["all", "All kept entries"],
] as const;

/** The database filter for the Activity log's search box and dropdowns. */
export function activityWhere(f: ActivityFilters, now = new Date()): Prisma.ActivityEntryWhereInput {
  const where: Prisma.ActivityEntryWhereInput = {};
  const days = f.days ?? "30";
  if (days !== "all") where.at = { gte: new Date(now.getTime() - (Number(days) || 30) * 86_400_000) };
  if (f.who) where.actorId = f.who;
  if (f.kind && f.kind in ACTIVITY_KINDS) where.kind = f.kind;
  if (f.umbrella) where.groupId = f.umbrella;
  const q = f.q?.trim();
  if (q)
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { detail: { contains: q, mode: "insensitive" } },
      { actorLabel: { contains: q, mode: "insensitive" } },
      { where: { contains: q, mode: "insensitive" } },
    ];
  return where;
}

export const pageSize = (f: ActivityFilters) => Math.min(Math.max(Number(f.limit) || 100, 100), 2000);
