"use client";

import { useEffect, useState } from "react";

/** Playwright's trace viewer in a frame, pointed at the replay file on this server (ver_93). */
export function ReplayFrame({ fileId }: { fileId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => setSrc(`/trace-viewer/index.html?trace=${encodeURIComponent(`${window.location.origin}/api/attachments/${fileId}`)}`), [fileId]);
  if (!src) return <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50" />;
  return <iframe src={src} title="Step-by-step replay" className="w-full flex-1 rounded-lg border border-slate-200 bg-white" data-testid="replay-frame" />;
}
