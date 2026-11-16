"use client";

import { useEffect, useState } from "react";

/**
 * Playwright's trace viewer in a frame, pointed at the replay file. `viewerUrl` is set when
 * replays live on their own address (TRACE_VIEWER_ORIGIN); otherwise it's this server.
 */
export function ReplayFrame({ fileId, viewerUrl }: { fileId: string; viewerUrl?: string | null }) {
  const [src, setSrc] = useState<string | null>(viewerUrl ?? null);
  useEffect(() => {
    if (!viewerUrl) setSrc(`/trace-viewer/index.html?trace=${encodeURIComponent(`${window.location.origin}/api/attachments/${fileId}`)}`);
  }, [fileId, viewerUrl]);
  if (!src) return <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50" />;
  return <iframe src={src} title="Step-by-step replay" className="w-full flex-1 rounded-lg border border-slate-200 bg-white" data-testid="replay-frame" />;
}
