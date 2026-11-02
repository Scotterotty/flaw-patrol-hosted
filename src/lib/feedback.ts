import { z } from "zod";

/**
 * Feedback about Flaw Patrol itself (ver_145): the Feedback button in the top bar, and the
 * Feedback page. Never counted or ranked by person: the page lists feedback, not people.
 */
export const FEEDBACK_KINDS = [
  { id: "broken", label: "Something's broken" },
  { id: "confusing", label: "Confusing" },
  { id: "idea", label: "Idea" },
  { id: "like", label: "I like this" },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["id"];

export const FEEDBACK_STATUSES = [
  { id: "new", label: "New", open: true },
  { id: "looking", label: "Looking at it", open: true },
  { id: "planned", label: "Planned", open: true },
  { id: "done", label: "Done", open: false },
  { id: "wontdo", label: "Won't do", open: false },
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]["id"];

export const kindLabel = (id: string) => FEEDBACK_KINDS.find((k) => k.id === id)?.label ?? "Feedback";
export const statusLabel = (id: string) => FEEDBACK_STATUSES.find((s) => s.id === id)?.label ?? "New";
export const isOpenStatus = (id: string) => FEEDBACK_STATUSES.find((s) => s.id === id)?.open ?? true;

/** Up to 3 pictures, each up to 8 MB (a marked-up screenshot is a PNG, usually well under 1 MB). */
export const MAX_SHOTS = 3;
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const feedbackInput = z.object({
  kind: z.enum(FEEDBACK_KINDS.map((k) => k.id) as [FeedbackKind, ...FeedbackKind[]], { message: "Pick what kind of feedback it is." }),
  message: z.string().trim().max(10000, "Keep it under 10,000 characters."),
  place: z.string().trim().max(500).default(""),
  path: z.string().trim().max(1000).default(""),
  browser: z.string().trim().max(100).default(""),
  anonymous: z.boolean().default(false),
});
export type FeedbackInput = z.input<typeof feedbackInput>;

export const statusSchema = z.enum(FEEDBACK_STATUSES.map((s) => s.id) as [FeedbackStatus, ...FeedbackStatus[]]);

/** "Chrome on Windows" from the browser's user agent: enough to reproduce, nothing more. */
export function browserName(ua: string) {
  const b = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${b} on ${os}` : b;
}

/** Only a path inside Flaw Patrol is kept, so the "Open where it was sent" link can't go elsewhere. */
export function safeFeedbackPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "";
}

const AREAS: Record<string, string> = {
  cases: "Test cases",
  import: "Test cases",
  charters: "Charters",
  stories: "Requirements",
  suites: "Test suites",
  "shared-steps": "Shared steps",
  glossary: "Glossary",
  runs: "Test runs",
  quests: "Quest map",
  bashes: "Bug bashes",
  risk: "Risk board",
  bugs: "Bugs",
  reports: "Reports",
  settings: "Settings",
};

/** The part of Flaw Patrol a page belongs to, for the Where filter. */
export function areaOf(path: string) {
  const p = path.split(/[?#]/)[0];
  const cycle = /^\/p\/[^/]+(?:\/([^/]+))?/.exec(p);
  if (cycle) return cycle[1] ? (AREAS[cycle[1]] ?? "Other pages") : "Overview";
  const umbrella = /^\/g\/[^/]+(?:\/([^/]+))?/.exec(p);
  if (umbrella) return umbrella[1] ? (AREAS[umbrella[1]] ?? "Other pages") : "Overview";
  if (p === "/" || p === "") return "Projects";
  if (p.startsWith("/account")) return "Your account";
  if (p.startsWith("/workspace")) return "Workspace settings";
  if (p.startsWith("/feedback")) return "Feedback";
  return "Other pages";
}
