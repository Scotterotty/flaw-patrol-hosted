// Client-safe settings and words for automation files; the reading lives in automation-media.ts.

export type MediaCounts = { screenshots: number; videos: number; replays: number; bytes: number };

export const KEEP = [
  { id: "failed", label: "Failed and flaky tests only", tip: "Recommended. Passing tests rarely need a picture." },
  { id: "all", label: "Every test", tip: "Uses far more space." },
] as const;
export const MAX_MB = [25, 50, 100] as const;
export type FileSettings = { keep: "failed" | "all"; maxMb: (typeof MAX_MB)[number] };
export const DEFAULT_FILES: FileSettings = { keep: "failed", maxMb: 50 };

export function parseFileSettings(v: unknown): FileSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<FileSettings>;
  return { keep: o.keep === "all" ? "all" : "failed", maxMb: MAX_MB.includes(o.maxMb as never) ? (o.maxMb as FileSettings["maxMb"]) : DEFAULT_FILES.maxMb };
}

/** "5 screenshots, 3 videos, 5 replays". */
export function mediaWords(c: Omit<MediaCounts, "bytes">) {
  const w = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");
  return [w(c.screenshots, "screenshot", "screenshots"), w(c.videos, "video", "videos"), w(c.replays, "replay", "replays")].filter(Boolean).join(", ");
}

export const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export type AutoStepRow = { title: string; ok: boolean; ms: number | null };

/** TestResult.testSteps, read safely. */
export function parseSteps(v: unknown): AutoStepRow[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s) => s && typeof s === "object" && typeof s.title === "string").map((s) => ({ title: s.title, ok: s.ok !== false, ms: typeof s.ms === "number" ? s.ms : null }));
}
