import "server-only";
import { db } from "./db";
import type { AreaContext } from "./area-tags";
import { parseTagColors, type TagColors } from "./tags";
import { parsePlatforms, platformColor } from "./umbrella";

/** The umbrella's platform names for a library project (its hub), or a test cycle in it. */
export async function platformNamesFor(projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { hubOf: { select: { platforms: true } }, group: { select: { platforms: true, hubProjectId: true } } } });
  const raw = p?.hubOf?.platforms ?? (p?.group?.hubProjectId ? p.group.platforms : null);
  return parsePlatforms(raw).map((x) => x.name);
}

/**
 * Tag colors for a library (ver_96): ones someone picked, then platform colors for tags
 * named after a platform. Tags without either get a color from their name on screen.
 */
export async function tagColorsFor(projectId: string): Promise<TagColors> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: { tagColors: true, hubOf: { select: { platforms: true } }, group: { select: { platforms: true, hubProjectId: true, hub: { select: { tagColors: true } } } } } });
  if (!p) return {};
  const platforms = parsePlatforms(p.hubOf?.platforms ?? (p.group?.hubProjectId ? p.group.platforms : null));
  const fromPlatforms = Object.fromEntries(platforms.map((x) => [x.name.toLowerCase(), platformColor(platforms, x.name)]));
  // A test cycle in an umbrella uses its Case library's colors.
  const own = parseTagColors(p.hubOf ? p.tagColors : (p.group?.hub?.tagColors ?? p.tagColors));
  return { ...fromPlatforms, ...own };
}

/** Names a new [bracket] tag should be spelled like: the platforms, then tags the library already has. */
export async function knownTagNamesFor(projectId: string, opts: { platforms?: boolean } = {}) {
  const tags = await db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${projectId}`;
  return [...(opts.platforms === false ? [] : await platformNamesFor(projectId)), ...tags.map((t) => t.tag)];
}

/** What area tags (ver_102) need for a library: platforms, its other tags, and words it said No to. */
export async function areaContextFor(projectId: string): Promise<AreaContext> {
  const [platforms, tags, p] = await Promise.all([
    platformNamesFor(projectId),
    db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM "TestCase" WHERE "projectId" = ${projectId} AND archived = false`,
    db.project.findUnique({ where: { id: projectId }, select: { areaSkip: true } }),
  ]);
  return { platforms, known: tags.map((t) => t.tag), skip: p?.areaSkip ?? [] };
}
