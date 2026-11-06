/**
 * Files too big for Jira (ver_185). Jira refuses an upload over its attachment
 * limit, and one refused file used to take every other file down with it. Big
 * files now stay in Flaw Patrol: the bug box flags them before filing, and the
 * server skips them and attaches the rest one at a time.
 */

/** The team's Jira takes about 24 MB per file; used when Jira doesn't say, and as the most Flaw Patrol sends. */
export const JIRA_FILE_LIMIT = 24 * 1024 * 1024;

/** The limit to use: Jira's own when it reports a smaller one, otherwise 24 MB. */
export function jiraFileLimit(reported?: number | null) {
  return typeof reported === "number" && reported > 0 ? Math.min(reported, JIRA_FILE_LIMIT) : JIRA_FILE_LIMIT;
}

/** "24 MB", "31.4 MB". */
export function mbText(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export const tooBigForJira = (size: number | undefined | null, limit = JIRA_FILE_LIMIT) => typeof size === "number" && size > limit;

/** The line shown under a file in the bug box. */
export const tooBigLine = (limit = JIRA_FILE_LIMIT) => `Too big for Jira (${mbText(limit)} max). Record a shorter clip, or file without it.`;

/** What the filer is told after filing, when files stayed behind. */
export function leftOutNote(key: string, tooBig: { fileName: string; size: number }[], failed: { fileName: string; why: string }[], limit = JIRA_FILE_LIMIT) {
  const parts: string[] = [];
  if (tooBig.length)
    parts.push(
      `${tooBig.map((f) => `${f.fileName} (${mbText(f.size)})`).join(", ")} ${tooBig.length === 1 ? "is" : "are"} too big for Jira (${mbText(limit)} max), so ${tooBig.length === 1 ? "it stayed" : "they stayed"} in Flaw Patrol.`,
    );
  if (failed.length) parts.push(`Jira didn't take ${failed.map((f) => `${f.fileName} (${f.why})`).join(", ")}.`);
  return parts.length ? `${key} was created. ${parts.join(" ")}` : null;
}
