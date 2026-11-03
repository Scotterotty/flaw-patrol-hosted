import type { Prisma } from "@prisma/client";

type PlatformLike = { name: string; suiteIds: string[]; caseIds?: string[] };

/** The library's tag spellings that name this platform (Web, WEB, web), since tags keep their case. */
export function platformTags(platform: PlatformLike, tags: string[]): string[] {
  const name = platform.name.trim().toLowerCase();
  return [...new Set(tags.filter((t) => t.trim().toLowerCase() === name))];
}

/**
 * Where a case counts as on a platform: in one of its suites, picked for it from folders,
 * or tagged with its name. Before ver_158 only the suites counted, so Web + a tag found nothing
 * when the Web cases were tagged rather than in a Web suite.
 */
export function platformCaseOr(platform: PlatformLike, tags: string[]): Prisma.TestCaseWhereInput[] {
  const or: Prisma.TestCaseWhereInput[] = [];
  if (platform.suiteIds.length) or.push({ suites: { some: { suiteId: { in: platform.suiteIds } } } });
  if (platform.caseIds?.length) or.push({ id: { in: platform.caseIds } });
  const named = platformTags(platform, tags);
  if (named.length) or.push({ tags: { hasSome: named } });
  // Nothing set up for it yet: no case is on it (an empty OR would match every case).
  if (!or.length) or.push({ id: { in: [] } });
  return or;
}

/** The same rule for one case already loaded, for the platform dots on each row. */
export function isOnPlatform(platform: PlatformLike, c: { id: string; tags: string[]; suiteIds: Set<string> }): boolean {
  const name = platform.name.trim().toLowerCase();
  return platform.suiteIds.some((id) => c.suiteIds.has(id)) || !!platform.caseIds?.includes(c.id) || c.tags.some((t) => t.trim().toLowerCase() === name);
}
